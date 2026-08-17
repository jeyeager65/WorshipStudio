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
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

use crate::domain::{media, people, remote, service_types, services, win32};
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

/// A short, label-only entry for the live slide picker (Full Control only) — never the slide's
/// own text/content, matching the phone's "short labels only" boundary (feature-spec.md
/// section 4): "Verse 1", "Matthew 1:1-3", never the full lyrics or scripture text.
#[derive(Clone, Serialize)]
struct SlideSummary {
    index: usize,
    label: String,
}

/// The real audience display's own logical resolution (see useLiveTransport.ts's
/// `presentationSize`, the same value its own Previous/Current/Next preview thumbnails use) —
/// pushed so the phone's mirror can letterbox/pillarbox to the *real* display's aspect ratio
/// instead of stretching to fill whatever shape the phone's own screen happens to be.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplaySize {
    width: u32,
    height: u32,
}

/// Bundles `RemoteServerHandle::update()`'s params — grew past the point a positional arg list
/// stayed readable (six and counting), and a struct also lets `commands::remote` build it
/// straight from the Tauri command's own deserialized input without restating every field.
pub struct LiveStateUpdate {
    pub content: Option<LiveSlideContent>,
    pub is_presenting: bool,
    pub external_app_active: bool,
    pub display_size: Option<(u32, u32)>,
    pub is_blank_screen: bool,
    pub background_only: bool,
}

#[derive(Default)]
struct SharedLiveState {
    content: Option<LiveSlideContent>,
    is_presenting: bool,
    slides: Vec<SlideSummary>,
    /// Set when the live item is an External App Hand-off (spec section 12) — the real
    /// Audience display shows the external app's own window in this case (nothing pushed to
    /// it), but the phone has no such window to fall back on, so it needs an explicit signal
    /// to show its own "an external app is on screen" placeholder instead of `content`, which
    /// is still pushed (just an app-name label with no useful body) for callers that don't
    /// check this flag.
    external_app_active: bool,
    display_size: Option<DisplaySize>,
    is_blank_screen: bool,
    background_only: bool,
    /// True whenever ServiceWorkspaceView is mounted, regardless of `is_presenting` — a device
    /// shouldn't see Start Presenting/Prev/Next/the slide picker until a service has actually
    /// been opened on the operator side (there's nothing yet for those to act on). Set/cleared
    /// from that view's own mount/unmount, not part of the content-push cycle above.
    service_open: bool,
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

    pub async fn update(&self, update: LiveStateUpdate) {
        let mut state = self.live.write().await;
        state.content = update.content;
        state.is_presenting = update.is_presenting;
        state.external_app_active = update.external_app_active;
        state.display_size = update
            .display_size
            .map(|(width, height)| DisplaySize { width, height });
        state.is_blank_screen = update.is_blank_screen;
        state.background_only = update.background_only;
    }

    /// Separate from `update()` above by design (see the plan/feature-spec.md section 4) — the
    /// outline only changes when the service's own content changes (load, edit, reorder), not
    /// on every single slide advance, so it's pushed from its own watcher rather than riding
    /// along with the moment-to-moment live-slide push.
    pub async fn update_slides(&self, slides: Vec<(usize, String)>) {
        let mut state = self.live.write().await;
        state.slides = slides
            .into_iter()
            .map(|(index, label)| SlideSummary { index, label })
            .collect();
    }

    /// See `SharedLiveState::service_open`'s own doc comment.
    pub async fn set_service_open(&self, open: bool) {
        self.live.write().await.service_open = open;
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

/// Remote Control pairing QR only (device provisioning/re-pairing, and the `/api/get_qr`-style
/// route below) — a native-only feature with no browser equivalent, so it stays Rust-side. The
/// Slide editor's QR element used to reuse this via a `generate_qr_code` command, but that was
/// pure/client-side work with no real reason to round-trip through Rust; it's now a shared
/// TypeScript implementation (`src/utils/qrCode.ts`) used identically by every adapter.
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

fn remote_token_cookie(token: &str) -> String {
    // The remote page never needs to read its bearer token from JavaScript. HttpOnly keeps a
    // compromised page script from extracting it; SameSite limits cross-site requests. Secure
    // cannot be used because Remote Control deliberately runs over plain HTTP on the local LAN.
    format!("remote_token={token}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax")
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

/// The standalone Remote Control Vue bundle (src-remote/, built by `pnpm build:remote`),
/// embedded at compile time — the directory-scale generalization of the single-file
/// `include_str!` this replaced. Always a fully self-contained binary either way, whether
/// installed or portable, with no runtime dependency on files existing next to the executable.
#[derive(RustEmbed)]
#[folder = "../dist-remote/"]
struct RemoteAssets;

/// Serves the embedded remote bundle for any path the API routes below don't otherwise claim —
/// `/` (and anything else without a matching embedded file, e.g. a stray trailing slash) falls
/// back to `index.html` since this is a single-page bundle, not a multi-page site.
async fn serve_remote_asset(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let (resolved_path, asset) = match RemoteAssets::get(path) {
        Some(file) => (path, Some(file)),
        None => ("index.html", RemoteAssets::get("index.html")),
    };
    match asset {
        Some(file) => {
            let content_type = guess_asset_content_type(resolved_path);
            (
                [(header::CONTENT_TYPE, content_type)],
                file.data.into_owned(),
            )
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
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
    if let Ok(cookie) = remote_token_cookie(&query.token).parse() {
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
    /// Only meaningful for `full-control` devices (the live slide picker) — sent to every
    /// device regardless of access level for simplicity, the same way `content` already is;
    /// view-only phones just have no UI that reads it.
    slides: Vec<SlideSummary>,
    external_app_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_size: Option<DisplaySize>,
    is_blank_screen: bool,
    background_only: bool,
    /// See `SharedLiveState::service_open`'s own doc comment.
    service_open: bool,
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
        slides: live.slides.clone(),
        external_app_active: live.external_app_active,
        display_size: live.display_size,
        is_blank_screen: live.is_blank_screen,
        background_only: live.background_only,
        service_open: live.service_open,
    })
    .into_response()
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ActionPayload {
    action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    service_id: Option<String>,
}

/// Access-level gating (feature-spec.md section 4): View Only gets nothing, Full Control adds
/// Next/Prev, jump-to-item, Start/Stop Presenting, and starting one of today's services.
/// Enforced here server-side rather than trusted from the phone's own UI, since the UI is just
/// what this same server served it — never assume a client only sends buttons it was shown.
fn action_allowed(access_level: &str, action: &str) -> bool {
    match access_level {
        "full-control" => matches!(
            action,
            "next"
                | "previous"
                | "goto"
                | "toggle-presenting"
                | "select-service"
                | "toggle-blank-screen"
                | "toggle-background-only"
                | "external-app-relaunch"
                | "external-app-close"
        ),
        _ => false,
    }
}

/// `select-service` is a *state* precondition, not a permission one — a device can be fully
/// entitled to it and still be refused right now because something is already live. Kept as
/// its own pure function (matching this file's `action_allowed` convention) so it's testable
/// without spinning up a real `RemoteServerHandle`/`AppHandle`.
fn select_service_allowed_now(is_presenting: bool) -> bool {
    !is_presenting
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
    if payload.action == "select-service" {
        let is_presenting = handle.live.read().await.is_presenting;
        if !select_service_allowed_now(is_presenting) {
            return StatusCode::CONFLICT;
        }
    }
    let _ = handle.app.emit("remote:command", &payload);
    StatusCode::OK
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TodayServiceSummary {
    id: String,
    date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    time: Option<String>,
    service_type: String,
}

/// Full-control-only, same as the button that acts on it — even just seeing today's schedule
/// is part of Full Control's elevated visibility, not something every paired device gets.
async fn get_todays_services(
    State(handle): State<RemoteServerHandle>,
    headers: HeaderMap,
) -> Response {
    let Some(device) = device_from_headers(&headers, &handle.app) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if device.access_level != "full-control" {
        return StatusCode::FORBIDDEN.into_response();
    }
    let today = chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();
    let root = library_root(&handle.app);
    // ServicePicker.vue (src-remote/) shows this as plain visible text — Service::service_type_id
    // is an id, not display text, so it's resolved to its real name here rather than leaking the
    // id into the Remote Control UI.
    let type_names: std::collections::HashMap<String, String> = service_types::list(&root)
        .unwrap_or_default()
        .into_iter()
        .map(|t| (t.id, t.name))
        .collect();
    match services::list_upcoming(&root, &today, &today) {
        Ok(list) => Json(
            list.into_iter()
                .map(|s| TodayServiceSummary {
                    id: s.id,
                    date: s.date,
                    time: s.time,
                    service_type: type_names
                        .get(&s.service_type_id)
                        .cloned()
                        .unwrap_or(s.service_type_id),
                })
                .collect::<Vec<_>>(),
        )
        .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
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

/// Same best-effort-by-extension approach as `guess_content_type` above, but for embedded static
/// bundles' own asset types rather than media library files — kept as a separate function since
/// the two serve genuinely different file sets or a merged match arm would read as covering
/// things it doesn't (test suite fixtures below for each stay clearly matched to the function
/// they're actually testing). `pub(crate)` since lib.rs's `help` URI scheme handler (serving the
/// embedded VitePress help site) reuses this too, not just the Remote Control bundle below.
pub(crate) fn guess_asset_content_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "woff2" => "font/woff2",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Serves the actual media file bytes to a paired phone (spec section 4's confidence-monitor
/// mirror) — a `convertFileSrc` URL only resolves inside this app's own webviews, so the
/// mirror needs its own real, network-reachable way to fetch the same content. No Range/206
/// support yet (a whole-file read per request) — fine for a confidence monitor watching along,
/// not built for scrubbing/seeking.
#[derive(Deserialize)]
struct QrQuery {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QrResponse {
    data_url: String,
}

// QR codes have a real, version-dependent capacity ceiling — this cap is well under it, just
// enough for the short strings the reused SlideSceneRenderer's QR scene elements actually pass
// (a URL or a short label), so a caller can get a clean 400 instead of relying on the encoder's
// own capacity error to fail closed.
const MAX_QR_TEXT_LEN: usize = 500;

/// Backs the reused SlideSceneRenderer's QR scene elements (see remoteAdapter.ts's
/// `slides.generateQrCode` shim) — cookie-authenticated like `/api/media`, any paired device
/// rather than full-control-only, since a QR scene element can appear on any slide type.
async fn get_qr(
    State(handle): State<RemoteServerHandle>,
    headers: HeaderMap,
    Query(query): Query<QrQuery>,
) -> Response {
    if device_from_headers(&headers, &handle.app).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if query.text.len() > MAX_QR_TEXT_LEN {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match qr_data_url(&query.text) {
        Ok(data_url) => Json(QrResponse { data_url }).into_response(),
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

/// Confidence-monitor-of-last-resort for External App Hand-off: the mirror's own placeholder
/// (`externalAppActive`) is honest about there being nothing to render from `LiveSlideContent`,
/// but a real screenshot of the actual presentation window closes that gap for whoever wants
/// it. Any paired device, not just Full Control — this is read-only, same trust level as
/// `/api/media`, not an elevated capability. Windows-only (see win32.rs's own doc comment on
/// why External App Hand-off itself is Windows-only); the non-Windows build of
/// `capture_window_png` always returns its own clear error, surfaced here as a 501.
async fn get_screenshot(State(handle): State<RemoteServerHandle>, headers: HeaderMap) -> Response {
    if device_from_headers(&headers, &handle.app).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(presentation) = handle.app.get_webview_window("presentation") else {
        return (
            StatusCode::NOT_FOUND,
            "Nothing is currently being presented.",
        )
            .into_response();
    };
    let hwnd = match presentation.window_handle().map(|h| h.as_raw()) {
        Ok(RawWindowHandle::Win32(raw)) => raw.hwnd.get(),
        _ => {
            return (
                StatusCode::NOT_IMPLEMENTED,
                "Screenshots are only supported on Windows.",
            )
                .into_response()
        }
    };
    match win32::capture_window_png(hwnd) {
        Ok(bytes) => ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        Err(message) => (StatusCode::INTERNAL_SERVER_ERROR, message).into_response(),
    }
}

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
        .route("/pair", get(pair))
        .route("/api/state", get(get_state))
        .route("/api/action", post(post_action))
        .route("/api/media/{id}", get(get_media))
        .route("/api/screenshot", get(get_screenshot))
        .route("/api/qr", get(get_qr))
        .route("/api/services/today", get(get_todays_services))
        // Everything else (the embedded bundle: index.html, its JS/CSS, manifest, icons) — a
        // fallback rather than named routes since the bundle's own asset filenames change on
        // every build (Vite's content hashing).
        .fallback(get(serve_remote_asset))
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
    fn remote_pairing_cookie_is_http_only_and_same_site() {
        let cookie = remote_token_cookie("secret-token");
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(!cookie.contains("Secure"));
    }

    #[test]
    fn action_allowed_view_only_gets_nothing() {
        assert!(!action_allowed("view-only", "next"));
        assert!(!action_allowed("view-only", "previous"));
        assert!(!action_allowed("view-only", "goto"));
        assert!(!action_allowed("view-only", "toggle-presenting"));
        assert!(!action_allowed("view-only", "select-service"));
        assert!(!action_allowed("view-only", "external-app-relaunch"));
        assert!(!action_allowed("view-only", "external-app-close"));
    }

    #[test]
    fn action_allowed_full_control_gets_everything() {
        assert!(action_allowed("full-control", "next"));
        assert!(action_allowed("full-control", "previous"));
        assert!(action_allowed("full-control", "goto"));
        assert!(action_allowed("full-control", "toggle-presenting"));
        assert!(action_allowed("full-control", "select-service"));
        assert!(action_allowed("full-control", "toggle-blank-screen"));
        assert!(action_allowed("full-control", "toggle-background-only"));
        assert!(action_allowed("full-control", "external-app-relaunch"));
        assert!(action_allowed("full-control", "external-app-close"));
    }

    #[test]
    fn action_allowed_rejects_an_unknown_access_level() {
        assert!(!action_allowed("not-a-real-level", "next"));
    }

    #[test]
    fn select_service_allowed_now_blocks_only_while_presenting() {
        assert!(select_service_allowed_now(false));
        assert!(!select_service_allowed_now(true));
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
    fn qr_data_url_rejects_text_over_the_encoders_own_capacity() {
        // Well past what any QR version can hold (2,953 bytes at the largest, lowest-error-
        // correction version) — `get_qr`'s own MAX_QR_TEXT_LEN cap exists so a caller gets a
        // clean 400 instead of relying on this to fail closed, but this confirms the encoder
        // itself errors rather than panicking if that cap were ever bypassed.
        let too_long = "x".repeat(4000);
        assert!(qr_data_url(&too_long).is_err());
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

    #[test]
    fn guess_asset_content_type_recognizes_the_embedded_bundles_own_file_types() {
        assert_eq!(
            guess_asset_content_type("index.html"),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            guess_asset_content_type("assets/index-abc123.js"),
            "application/javascript"
        );
        assert_eq!(
            guess_asset_content_type("assets/index-abc123.css"),
            "text/css"
        );
        assert_eq!(
            guess_asset_content_type("manifest.webmanifest"),
            "application/manifest+json"
        );
        assert_eq!(guess_asset_content_type("sw.js"), "application/javascript");
    }

    #[test]
    fn guess_asset_content_type_falls_back_for_an_unknown_extension() {
        assert_eq!(
            guess_asset_content_type("mystery.xyz"),
            "application/octet-stream"
        );
    }
}
