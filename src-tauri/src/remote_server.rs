//! Remote Control's local HTTP server (design/feature-spec.md section 4) — a phone/tablet on
//! the same LAN pairs by scanning a QR code (see commands::remote::provision_remote_device)
//! and then talks to this server directly; it never talks to the Tauri app any other way.
//!
//! The server itself has zero awareness of songs/scripture/slides — it only mirrors whatever
//! `LiveSlideContent` + is-presenting state the operator window last pushed via
//! `update_remote_live_state`, and relays button presses back to the operator window as a
//! `remote:command` event, exactly the way the presentation window already receives
//! `live:slide-changed`. This keeps every actual content decision in the frontend, where the
//! rest of live-presentation state already lives.

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::path::Path;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex, RwLock as StdRwLock};

use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use mdns_sd::{DaemonEvent, ServiceDaemon, ServiceInfo};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;

use crate::domain::{media, people, remote};
use crate::models::LiveSlideContent;
use crate::paths::{
    default_canva_callback_port, is_portable, library_root, load_machine_settings,
    local_media_root, remote_devices_path, save_machine_settings, INSTALLED_CANVA_CALLBACK_PORT,
    PORTABLE_CANVA_CALLBACK_PORT,
};

// 47823 and 47824 are reserved for the installed and portable Canva loopback callbacks. LAN
// Remote Control begins after them so installed and portable copies can run together.
pub const DEFAULT_REMOTE_SERVER_PORT: u16 = 47825;
const AUTO_PORT_SCAN_COUNT: u16 = 20;

#[derive(Default)]
struct SharedLiveState {
    content: Option<LiveSlideContent>,
    is_presenting: bool,
}

#[derive(Clone)]
pub struct CanvaOAuthPending {
    pub state: String,
    pub code_verifier: String,
}

#[derive(Default)]
struct CanvaOAuthState {
    pending: Option<CanvaOAuthPending>,
    error: Option<String>,
}

/// Managed as Tauri app state (so `update_remote_live_state` can write to it) and also handed
/// to the axum router as its extractor state (so request handlers can read it) — the same
/// `Arc<RwLock<_>>` either way, just two different call sites needing a handle to it.
#[derive(Clone)]
pub struct RemoteServerHandle {
    live: Arc<RwLock<SharedLiveState>>,
    canva: Arc<RwLock<CanvaOAuthState>>,
    port: Arc<AtomicU16>,
    canva_port: Arc<AtomicU16>,
    hostname: Arc<StdRwLock<Option<String>>>,
    mdns: Arc<Mutex<Option<ServiceDaemon>>>,
    pub(crate) app: AppHandle,
}

impl RemoteServerHandle {
    pub fn new(app: AppHandle) -> Self {
        Self {
            live: Arc::new(RwLock::new(SharedLiveState::default())),
            canva: Arc::new(RwLock::new(CanvaOAuthState::default())),
            port: Arc::new(AtomicU16::new(0)),
            canva_port: Arc::new(AtomicU16::new(0)),
            hostname: Arc::new(StdRwLock::new(None)),
            mdns: Arc::new(Mutex::new(None)),
            app,
        }
    }

    pub fn port(&self) -> Option<u16> {
        match self.port.load(Ordering::Relaxed) {
            0 => None,
            port => Some(port),
        }
    }

    pub fn canva_port(&self) -> Option<u16> {
        match self.canva_port.load(Ordering::Relaxed) {
            0 => None,
            port => Some(port),
        }
    }

    pub fn hostname(&self) -> Option<String> {
        self.hostname.read().ok()?.clone()
    }

    fn set_hostname(&self, hostname: String) {
        if let Ok(mut current) = self.hostname.write() {
            *current = Some(hostname);
        }
    }

    fn retain_mdns_daemon(&self, daemon: ServiceDaemon) {
        if let Ok(mut current) = self.mdns.lock() {
            *current = Some(daemon);
        }
    }

    pub async fn update(&self, content: Option<LiveSlideContent>, is_presenting: bool) {
        let mut state = self.live.write().await;
        state.content = content;
        state.is_presenting = is_presenting;
    }

    pub async fn set_canva_oauth(&self, pending: CanvaOAuthPending) {
        let mut canva = self.canva.write().await;
        canva.pending = Some(pending);
        canva.error = None;
    }

    pub async fn take_canva_oauth(&self, state: &str) -> Option<CanvaOAuthPending> {
        let mut canva = self.canva.write().await;
        if canva
            .pending
            .as_ref()
            .is_some_and(|pending| pending.state == state)
        {
            canva.pending.take()
        } else {
            None
        }
    }

    pub async fn clear_canva_oauth(&self) {
        let mut canva = self.canva.write().await;
        canva.pending = None;
        canva.error = None;
    }

    pub async fn set_canva_error(&self, error: Option<String>) {
        self.canva.write().await.error = error;
    }

    pub async fn canva_status(&self) -> (bool, Option<String>) {
        let canva = self.canva.read().await;
        (canva.pending.is_some(), canva.error.clone())
    }
}

/// The UDP-connect trick: this never actually sends a packet (UDP `connect` just picks a
/// route), so it works fully offline — it's just a reliable way to ask the OS "which of my
/// network interfaces would traffic leave from," which is the LAN-facing IP a phone on the
/// same network can actually reach.
pub fn local_lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

pub fn qr_data_url(url: &str) -> Result<String, String> {
    let code = qrcode::QrCode::new(url.as_bytes()).map_err(|e| e.to_string())?;
    let buffer = code.render::<image::Luma<u8>>().build();
    let dynamic = image::DynamicImage::ImageLuma8(buffer);
    let mut png_bytes: Vec<u8> = Vec::new();
    dynamic
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes)
    ))
}

fn sanitize_hostname_label(raw: &str) -> String {
    let lowercase = raw.to_ascii_lowercase();
    let without_suffix = lowercase
        .strip_suffix(".local.")
        .or_else(|| lowercase.strip_suffix(".local"))
        .unwrap_or(&lowercase);
    let mut normalized = String::with_capacity(without_suffix.len());
    for character in without_suffix.chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character);
        } else if !normalized.ends_with('-') {
            normalized.push('-');
        }
        if normalized.len() == 63 {
            break;
        }
    }
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        "worshipstudio".to_string()
    } else {
        normalized.to_string()
    }
}

fn normalized_hostname_label(
    configured: Option<&str>,
    computer_name: &str,
    portable: bool,
) -> String {
    if let Some(configured) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        return sanitize_hostname_label(configured);
    }
    if portable {
        return "worshipstudio-portable".to_string();
    }
    let computer_label = sanitize_hostname_label(computer_name);
    let computer_label = computer_label
        .strip_prefix("worshipstudio-")
        .unwrap_or(&computer_label);
    let default = if computer_label == "worshipstudio" {
        "worshipstudio".to_string()
    } else {
        format!("worshipstudio-{computer_label}")
    };
    sanitize_hostname_label(&default)
}

fn advertise_mdns(handle: &RemoteServerHandle, hostname: &str, port: u16) -> Result<(), String> {
    let daemon = ServiceDaemon::new().map_err(|error| error.to_string())?;
    let monitor = daemon.monitor().map_err(|error| error.to_string())?;
    let fqdn = format!("{hostname}.");
    let service = ServiceInfo::new(
        "_http._tcp.local.",
        "Worship Studio Remote Control",
        &fqdn,
        "",
        port,
        &[("path", "/")][..],
    )
    .map_err(|error| error.to_string())?
    .enable_addr_auto();
    handle.set_hostname(hostname.to_string());
    let current_hostname = Arc::clone(&handle.hostname);
    let registered_fqdn = fqdn.clone();
    std::thread::spawn(move || {
        while let Ok(event) = monitor.recv() {
            match event {
                DaemonEvent::NameChange(change)
                    if change.original.eq_ignore_ascii_case(&registered_fqdn) =>
                {
                    let resolved = change.new_name.trim_end_matches('.').to_string();
                    log::warn!(
                        "Remote Control mDNS hostname was already in use; advertising as {resolved}"
                    );
                    if let Ok(mut current) = current_hostname.write() {
                        *current = Some(resolved);
                    }
                }
                DaemonEvent::Error(error) => log::warn!("Remote Control mDNS error: {error}"),
                _ => {}
            }
        }
    });
    daemon
        .register(service)
        .map_err(|error| error.to_string())?;
    handle.retain_mdns_daemon(daemon);
    Ok(())
}

/// Pulled out from device_from_headers below purely so the parsing itself (not the
/// AppHandle-dependent device lookup that follows it) is unit-testable.
fn parse_remote_token_cookie(cookie_header: &str) -> Option<String> {
    cookie_header.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == "remote_token").then(|| value.to_string())
    })
}

fn device_from_headers(
    headers: &HeaderMap,
    app: &AppHandle,
) -> Option<crate::models::RemoteDevice> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let token = parse_remote_token_cookie(cookie_header)?;
    authorized_device_by_token(app, &token)
}

fn authorized_device_by_token(app: &AppHandle, token: &str) -> Option<crate::models::RemoteDevice> {
    let device = match remote::find_by_token(&remote_devices_path(app), token) {
        Ok(device) => device?,
        Err(error) => {
            log::error!("Could not read paired Remote Control devices: {error}");
            return None;
        }
    };
    let person_id = device.person_id.as_deref()?;
    people::exists(&library_root(app), person_id).then_some(device)
}

async fn index_page() -> Html<&'static str> {
    Html(include_str!("remote_page.html"))
}

#[derive(Deserialize)]
struct PairQuery {
    token: String,
}

async fn pair(
    State(handle): State<RemoteServerHandle>,
    Query(query): Query<PairQuery>,
) -> Response {
    if authorized_device_by_token(&handle.app, &query.token).is_none() {
        return (StatusCode::NOT_FOUND, "Invalid or revoked pairing link.").into_response();
    }
    let mut response = Redirect::to("/").into_response();
    // No `Secure` attribute — this is plain HTTP on a LAN by design (see feature-spec.md's
    // remote control section), so requiring HTTPS would just break the cookie outright.
    // A ~10-year Max-Age matches "pair once, stay authorized indefinitely" from the spec.
    if let Ok(cookie) = format!(
        "remote_token={}; Path=/; Max-Age=315360000; SameSite=Lax",
        query.token
    )
    .parse()
    {
        response.headers_mut().insert(header::SET_COOKIE, cookie);
    }
    response
}

#[derive(Deserialize)]
struct CanvaCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

async fn canva_callback(
    State(handle): State<RemoteServerHandle>,
    Query(query): Query<CanvaCallbackQuery>,
) -> Response {
    let result = if let Some(error) = query.error {
        let message = query.error_description.unwrap_or(error);
        handle.set_canva_error(Some(message.clone())).await;
        Err(message)
    } else {
        match (query.code, query.state) {
            (Some(code), Some(state)) => {
                crate::commands::canva::complete_oauth(&handle, code, state).await
            }
            _ => Err("Canva did not return the expected authorization details.".to_string()),
        }
    };
    let (title, message) = match result {
        Ok(()) => (
            "Canva connected",
            "You can close this window and return to Worship Studio.",
        ),
        Err(_) => (
            "Could not connect Canva",
            "Return to Worship Studio for details and try again.",
        ),
    };
    Html(format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
         <body style=\"font:16px system-ui;background:#111827;color:#fff;display:grid;place-items:center;height:100vh;margin:0\">\
         <main style=\"text-align:center\"><h1>{title}</h1><p>{message}</p></main></body></html>"
    ))
    .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    device_name: String,
    is_presenting: bool,
    content: Option<LiveSlideContent>,
    access_level: String,
}

async fn get_state(State(handle): State<RemoteServerHandle>, headers: HeaderMap) -> Response {
    let Some(device) = device_from_headers(&headers, &handle.app) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let live = handle.live.read().await;
    Json(StatePayload {
        device_name: device.name,
        is_presenting: live.is_presenting,
        content: live.content.clone(),
        access_level: device.access_level,
    })
    .into_response()
}

#[derive(Deserialize, Serialize, Clone)]
struct ActionPayload {
    action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
}

/// Access-level gating (feature-spec.md section 4): View Only gets nothing, Advance Only
/// adds Next/Prev, Full Control adds jump-to-item and Start/Stop Presenting. Enforced here
/// server-side rather than trusted from the phone's own UI, since the UI is just what this
/// same server served it — never assume a client only sends buttons it was shown.
fn action_allowed(access_level: &str, action: &str) -> bool {
    match access_level {
        "advance-only" => matches!(action, "next" | "previous"),
        "full-control" => matches!(action, "next" | "previous" | "goto" | "toggle-presenting"),
        _ => false,
    }
}

async fn post_action(
    State(handle): State<RemoteServerHandle>,
    headers: HeaderMap,
    Json(payload): Json<ActionPayload>,
) -> StatusCode {
    let Some(device) = device_from_headers(&headers, &handle.app) else {
        return StatusCode::UNAUTHORIZED;
    };
    if !action_allowed(&device.access_level, &payload.action) {
        return StatusCode::FORBIDDEN;
    }
    let _ = handle.app.emit("remote:command", &payload);
    StatusCode::OK
}

/// Best-effort by extension — good enough for the browser to know how to render/play what
/// follows; not a security boundary (the browser also sniffs), so an unknown extension just
/// falls back to a generic binary type rather than erroring.
fn guess_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Serves the actual media file bytes to a paired phone (spec section 4's confidence-monitor
/// mirror) — a `convertFileSrc` URL only resolves inside this app's own webviews, so the
/// mirror needs its own real, network-reachable way to fetch the same content. No Range/206
/// support yet (a whole-file read per request) — fine for a confidence monitor watching along,
/// not built for scrubbing/seeking.
async fn get_media(
    State(handle): State<RemoteServerHandle>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if device_from_headers(&headers, &handle.app).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let root = library_root(&handle.app);
    let Ok(Some(item)) = media::get(&root, &id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let path = media::file_path(&root, &local_media_root(&handle.app), &item);
    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, guess_content_type(&path))], bytes).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

fn router(handle: RemoteServerHandle) -> Router {
    Router::new()
        .route("/", get(index_page))
        .route("/pair", get(pair))
        .route("/api/state", get(get_state))
        .route("/api/action", post(post_action))
        .route("/api/media/{id}", get(get_media))
        .with_state(handle)
}

fn canva_callback_router(handle: RemoteServerHandle) -> Router {
    Router::new()
        .route("/canva/callback", get(canva_callback))
        .with_state(handle)
}

/// Spawned once at app startup (see lib.rs's `.setup()`) on Tauri's own async runtime, so a
/// bind failure (e.g. the port's already in use) just logs rather than crashing the app —
/// Remote Control not being reachable shouldn't take down live presentation with it.
pub fn start(handle: RemoteServerHandle) {
    tauri::async_runtime::spawn(async move {
        let mut settings = load_machine_settings(&handle.app);
        let canva_callback_port = settings
            .canva_callback_port
            .unwrap_or_else(|| default_canva_callback_port(is_portable(&handle.app)));
        let canva_addr = SocketAddr::from(([127, 0, 0, 1], canva_callback_port));
        match tokio::net::TcpListener::bind(canva_addr).await {
            Ok(listener) => {
                handle
                    .canva_port
                    .store(canva_callback_port, Ordering::Relaxed);
                let canva_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) =
                        axum::serve(listener, canva_callback_router(canva_handle)).await
                    {
                        log::error!("Canva callback server stopped: {error}");
                    }
                });
                log::info!("Canva callback listening on 127.0.0.1:{canva_callback_port}");
            }
            Err(error) => {
                let message = format!(
                    "Canva callback port {canva_callback_port} is unavailable. Choose another port in Settings and reload Worship Studio."
                );
                log::error!("{message}: {error}");
                handle.set_canva_error(Some(message)).await;
            }
        }
        let configured_port = settings.remote_control_port;
        let mut candidates = Vec::new();
        if let Some(port) = configured_port {
            candidates.push(port);
        } else {
            if let Some(port) = settings.last_remote_control_port.filter(|port| {
                *port != INSTALLED_CANVA_CALLBACK_PORT && *port != PORTABLE_CANVA_CALLBACK_PORT
            }) {
                candidates.push(port);
            }
            for port in DEFAULT_REMOTE_SERVER_PORT
                ..DEFAULT_REMOTE_SERVER_PORT.saturating_add(AUTO_PORT_SCAN_COUNT)
            {
                if port != INSTALLED_CANVA_CALLBACK_PORT
                    && port != PORTABLE_CANVA_CALLBACK_PORT
                    && !candidates.contains(&port)
                {
                    candidates.push(port);
                }
            }
            // Port zero asks the OS for any available port if the preferred range is occupied.
            candidates.push(0);
        }

        let mut last_error = None;
        let mut listener = None;
        for port in candidates {
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(bound) => {
                    listener = Some(bound);
                    break;
                }
                Err(error) => last_error = Some((addr, error)),
            }
        }

        let Some(listener) = listener else {
            if let Some((addr, error)) = last_error {
                log::error!("Failed to start the Remote Control server on {addr}: {error}");
            }
            return;
        };
        let actual_port = match listener.local_addr() {
            Ok(address) => address.port(),
            Err(error) => {
                log::error!("Could not determine the Remote Control server port: {error}");
                return;
            }
        };
        handle.port.store(actual_port, Ordering::Relaxed);
        if configured_port.is_none() && settings.last_remote_control_port != Some(actual_port) {
            settings.last_remote_control_port = Some(actual_port);
            if let Err(error) = save_machine_settings(&handle.app, &settings) {
                log::warn!("Could not remember the automatic Remote Control port: {error}");
            }
        }
        let hostname_label = normalized_hostname_label(
            settings.remote_control_hostname.as_deref(),
            &settings.this_computer_name,
            is_portable(&handle.app),
        );
        let hostname = format!("{hostname_label}.local");
        if let Err(error) = advertise_mdns(&handle, &hostname, actual_port) {
            log::warn!("Could not advertise Remote Control as {hostname}: {error}");
        }
        log::info!("Remote Control server listening on port {actual_port}");
        if let Err(error) = axum::serve(listener, router(handle)).await {
            log::error!("Remote control server stopped: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_hostname_uses_the_computer_name() {
        assert_eq!(
            normalized_hostname_label(None, "Sound Booth", false),
            "worshipstudio-sound-booth"
        );
    }

    #[test]
    fn portable_hostname_does_not_depend_on_the_current_computer() {
        assert_eq!(
            normalized_hostname_label(None, "Sound Booth", true),
            "worshipstudio-portable"
        );
        assert_eq!(
            normalized_hostname_label(None, "Pastor Laptop", true),
            "worshipstudio-portable"
        );
    }

    #[test]
    fn hostname_accepts_a_local_name_and_normalizes_it_to_a_dns_label() {
        assert_eq!(
            normalized_hostname_label(Some(" Sanctuary Remote.LOCAL "), "Sound Booth", false),
            "sanctuary-remote"
        );
    }

    #[test]
    fn hostname_is_limited_to_one_dns_label() {
        let hostname = normalized_hostname_label(Some(&"a".repeat(80)), "Sound Booth", false);
        assert_eq!(hostname.len(), 63);
    }

    #[test]
    fn parse_remote_token_cookie_finds_the_token_among_other_cookies() {
        assert_eq!(
            parse_remote_token_cookie("other=1; remote_token=abc123; another=2"),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn parse_remote_token_cookie_returns_none_when_absent() {
        assert_eq!(parse_remote_token_cookie("other=1; another=2"), None);
    }

    #[test]
    fn action_allowed_view_only_gets_nothing() {
        assert!(!action_allowed("view-only", "next"));
        assert!(!action_allowed("view-only", "previous"));
        assert!(!action_allowed("view-only", "goto"));
        assert!(!action_allowed("view-only", "toggle-presenting"));
    }

    #[test]
    fn action_allowed_advance_only_gets_next_and_previous_but_not_more() {
        assert!(action_allowed("advance-only", "next"));
        assert!(action_allowed("advance-only", "previous"));
        assert!(!action_allowed("advance-only", "goto"));
        assert!(!action_allowed("advance-only", "toggle-presenting"));
    }

    #[test]
    fn action_allowed_full_control_gets_everything() {
        assert!(action_allowed("full-control", "next"));
        assert!(action_allowed("full-control", "previous"));
        assert!(action_allowed("full-control", "goto"));
        assert!(action_allowed("full-control", "toggle-presenting"));
    }

    #[test]
    fn action_allowed_rejects_an_unknown_access_level() {
        assert!(!action_allowed("not-a-real-level", "next"));
    }

    #[test]
    fn local_lan_ip_resolves_to_something_on_this_machine() {
        // Just confirms the UDP-connect trick doesn't error on a normal dev machine — the
        // actual IP returned is environment-dependent, so there's nothing more specific to
        // assert without hardcoding this machine's network config.
        assert!(local_lan_ip().is_some());
    }

    #[test]
    fn qr_data_url_produces_a_real_png_data_url() {
        let url = qr_data_url("http://192.168.1.50:47823/pair?token=abc").unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn guess_content_type_recognizes_common_image_and_video_extensions() {
        assert_eq!(guess_content_type(Path::new("sunset.JPG")), "image/jpeg");
        assert_eq!(guess_content_type(Path::new("sunset.png")), "image/png");
        assert_eq!(guess_content_type(Path::new("clip.mp4")), "video/mp4");
        assert_eq!(guess_content_type(Path::new("clip.MOV")), "video/quicktime");
    }

    #[test]
    fn guess_content_type_falls_back_for_an_unknown_extension() {
        assert_eq!(
            guess_content_type(Path::new("mystery.xyz")),
            "application/octet-stream"
        );
    }
}
