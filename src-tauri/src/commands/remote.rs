use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::domain::remote;
use crate::models::{LiveSlideContent, RemoteDevice, RemoteDeviceSummary};
use crate::paths::{now_iso, remote_devices_path, this_device_name};
use crate::remote_server::{self, RemoteServerHandle, REMOTE_SERVER_PORT};

#[tauri::command]
pub fn list_remote_devices(app: AppHandle) -> Vec<RemoteDeviceSummary> {
    remote::list(&remote_devices_path(&app))
        .iter()
        .map(RemoteDeviceSummary::from)
        .collect()
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
    name: String,
    access_level: String,
) -> Result<ProvisionResult, String> {
    let token = uuid::Uuid::new_v4().to_string();
    let device = RemoteDevice {
        id: format!("device-{}", uuid::Uuid::new_v4()),
        name,
        access_level,
        token: token.clone(),
        updated_at: now_iso(),
        updated_by_device: this_device_name(&app),
    };
    remote::save(&remote_devices_path(&app), device).map_err(|e| e.to_string())?;

    let lan_ip = remote_server::local_lan_ip().ok_or_else(|| {
        "Couldn't determine this computer's LAN IP address — is it connected to a network?"
            .to_string()
    })?;
    let pairing_url = format!("http://{lan_ip}:{REMOTE_SERVER_PORT}/pair?token={token}");
    let qr_data_url = remote_server::qr_data_url(&pairing_url)?;
    Ok(ProvisionResult {
        qr_data_url,
        pairing_url,
    })
}

#[tauri::command]
pub fn revoke_remote_device(app: AppHandle, id: String) -> Result<(), String> {
    remote::delete(&remote_devices_path(&app), &id).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteServerInfo {
    pub lan_ip: Option<String>,
    pub port: u16,
}

/// Shown in Settings alongside the QR code as a manual-entry fallback, and so the operator
/// can tell at a glance whether the server even found a usable network address.
#[tauri::command]
pub fn get_remote_server_info() -> RemoteServerInfo {
    RemoteServerInfo {
        lan_ip: remote_server::local_lan_ip().map(|ip| ip.to_string()),
        port: REMOTE_SERVER_PORT,
    }
}

/// Pushed from the operator window whenever the live slide or presenting state changes (see
/// ServiceWorkspaceView's watchers) — the server has no other way to know what's live.
#[tauri::command]
pub async fn update_remote_live_state(
    app: AppHandle,
    content: Option<LiveSlideContent>,
    is_presenting: bool,
) {
    app.state::<RemoteServerHandle>()
        .update(content, is_presenting)
        .await;
}
