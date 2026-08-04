use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::domain::{people, remote};
use crate::models::{LiveSlideContent, RemoteDevice, RemoteDeviceSummary};
use crate::paths::{library_root, now_iso, remote_devices_path, this_device_name};
use crate::remote_server::{self, LiveStateUpdate, RemoteServerHandle};

#[tauri::command]
pub fn list_remote_devices(app: AppHandle) -> Result<Vec<RemoteDeviceSummary>, String> {
    Ok(remote::list(&remote_devices_path(&app))
        .map_err(|error| error.to_string())?
        .iter()
        .map(RemoteDeviceSummary::from)
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionResult {
    pub qr_data_url: String,
    /// Text fallback next to the QR code, for typing into a phone's browser manually when
    /// scanning isn't convenient.
    pub pairing_url: String,
}

#[tauri::command]
pub fn provision_remote_device(
    app: AppHandle,
    server: tauri::State<'_, RemoteServerHandle>,
    person_id: String,
    name: String,
    access_level: String,
) -> Result<ProvisionResult, String> {
    if !people::exists(&library_root(&app), &person_id) {
        return Err("Choose an existing person before pairing a device.".to_string());
    }
    let token = uuid::Uuid::new_v4().to_string();
    let device = RemoteDevice {
        id: format!("device-{}", uuid::Uuid::new_v4()),
        person_id: Some(person_id),
        name,
        access_level,
        token: token.clone(),
        updated_at: now_iso(),
        updated_by_device: this_device_name(&app),
    };
    remote::save(&remote_devices_path(&app), device).map_err(|e| e.to_string())?;

    pairing_result(&server, &token)
}

fn pairing_result(server: &RemoteServerHandle, token: &str) -> Result<ProvisionResult, String> {
    let port = server
        .port()
        .ok_or_else(|| "The Remote Control server is not available yet.".to_string())?;
    let host = server
        .hostname()
        .or_else(|| remote_server::local_lan_ip().map(|ip| ip.to_string()))
        .ok_or_else(|| {
            "Couldn't determine this computer's network address — is it connected to a network?"
                .to_string()
        })?;
    let pairing_url = format!("http://{host}:{port}/pair?token={token}");
    let qr_data_url = remote_server::qr_data_url(&pairing_url)?;
    Ok(ProvisionResult {
        qr_data_url,
        pairing_url,
    })
}

#[tauri::command]
pub fn repair_remote_device(
    app: AppHandle,
    server: tauri::State<'_, RemoteServerHandle>,
    id: String,
) -> Result<ProvisionResult, String> {
    let mut device = remote::list(&remote_devices_path(&app))
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|device| device.id == id)
        .ok_or_else(|| "That paired device no longer exists.".to_string())?;
    let person_id = device.person_id.as_deref().ok_or_else(|| {
        "This older pairing is not assigned to a person. Revoke it and pair it again.".to_string()
    })?;
    if !people::exists(&library_root(&app), person_id) {
        return Err("The person assigned to this device no longer exists.".to_string());
    }
    // A re-pair is also the recovery path if an old link or browser authorization may have
    // escaped. Rotate the bearer token so every previous cookie and QR code stops working.
    let token = uuid::Uuid::new_v4().to_string();
    let result = pairing_result(&server, &token)?;
    device.token = token;
    device.updated_at = now_iso();
    device.updated_by_device = this_device_name(&app);
    remote::save(&remote_devices_path(&app), device).map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn revoke_remote_device(app: AppHandle, id: String) -> Result<(), String> {
    remote::delete(&remote_devices_path(&app), &id).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteServerInfo {
    pub hostname: Option<String>,
    pub lan_ip: Option<String>,
    pub port: u16,
}

/// Shown in Settings alongside the QR code as a manual-entry fallback, and so the operator
/// can tell at a glance whether the server even found a usable network address.
#[tauri::command]
pub fn get_remote_server_info(
    server: tauri::State<'_, RemoteServerHandle>,
) -> Result<RemoteServerInfo, String> {
    Ok(RemoteServerInfo {
        hostname: server.hostname(),
        lan_ip: remote_server::local_lan_ip().map(|ip| ip.to_string()),
        port: server
            .port()
            .ok_or_else(|| "The Remote Control server is not available yet.".to_string())?,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStateUpdateInput {
    pub content: Option<LiveSlideContent>,
    pub is_presenting: bool,
    pub external_app_active: bool,
    pub display_width: Option<u32>,
    pub display_height: Option<u32>,
    pub is_blank_screen: bool,
    pub background_only: bool,
}

/// Pushed from the operator window whenever the live slide or presenting state changes (see
/// ServiceWorkspaceView's watchers) — the server has no other way to know what's live. Takes
/// one struct argument rather than a growing list of positional ones (matches
/// `RemoteServerHandle::update`'s own `LiveStateUpdate` — see its doc comment).
#[tauri::command]
pub async fn update_remote_live_state(app: AppHandle, payload: LiveStateUpdateInput) {
    let display_size = match (payload.display_width, payload.display_height) {
        (Some(width), Some(height)) => Some((width, height)),
        _ => None,
    };
    app.state::<RemoteServerHandle>()
        .update(LiveStateUpdate {
            content: payload.content,
            is_presenting: payload.is_presenting,
            external_app_active: payload.external_app_active,
            display_size,
            is_blank_screen: payload.is_blank_screen,
            background_only: payload.background_only,
        })
        .await;
}

/// Pushed once from ServiceWorkspaceView's own mount/unmount (see `SharedLiveState::service_open`'s
/// doc comment) — independent of the moment-to-moment content push above.
#[tauri::command]
pub async fn update_remote_service_open(app: AppHandle, open: bool) {
    app.state::<RemoteServerHandle>()
        .set_service_open(open)
        .await;
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideSummaryInput {
    pub index: usize,
    pub label: String,
}

/// Pushed from the operator window's own `watch(flatSlides, ...)` (see useLiveTransport.ts)
/// whenever the current service's slide list changes — load, edit, reorder — not on every
/// slide advance (that's `update_remote_live_state` above).
#[tauri::command]
pub async fn update_remote_service_outline(app: AppHandle, slides: Vec<SlideSummaryInput>) {
    app.state::<RemoteServerHandle>()
        .update_slides(slides.into_iter().map(|s| (s.index, s.label)).collect())
        .await;
}
