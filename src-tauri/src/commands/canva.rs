use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};

use crate::domain::media::MediaImportCommit;
use crate::domain::{delete_file_if_exists, manifest, media, read_json_file, write_json_file};
use crate::models::{MediaItem, MediaOrigin};
use crate::paths::{
    app_data_dir, canva_auth_path, library_root, local_media_root, now_iso, this_device_name,
};
use crate::remote_server::{CanvaOAuthPending, RemoteServerHandle};

const API_ROOT: &str = "https://api.canva.com/rest/v1";
const SCOPES: &str = "design:meta:read design:content:read design:content:write";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaStatus {
    configured: bool,
    connected: bool,
    connecting: bool,
    error: Option<String>,
    callback_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CanvaTokens {
    client_id: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CanvaDesign {
    pub id: String,
    pub title: String,
    pub edit_url: String,
    pub page_count: usize,
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaImportResult {
    design: CanvaDesign,
    pages: Vec<CanvaImportedPage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaImportedPage {
    page_number: usize,
    media: MediaItem,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaExportedPage {
    page_number: usize,
    export_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaExportPreview {
    design: CanvaDesign,
    pages: Vec<CanvaExportedPage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaPageToImport {
    page_number: usize,
    export_url: String,
}

/// No `pages` field, unlike CanvaImportResult — a video export is always the whole design, one
/// output file, not a set of per-page results.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaVideoExportResult {
    design: CanvaDesign,
    media: MediaItem,
}

/// `temp_path` is an opaque handle the frontend hands back unmodified to `import_canva_video`
/// once the operator has picked synced vs. local — same pattern as `StagedMediaFile.path`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvaVideoPreview {
    design: CanvaDesign,
    temp_path: String,
    size_bytes: u64,
}

fn credentials(app: &AppHandle) -> Result<(String, String), String> {
    let settings = crate::commands::settings::load_library_settings(app)?;
    let id = settings.canva_integration.client_id.trim().to_string();
    let secret = settings.canva_integration.client_secret.trim().to_string();
    if id.is_empty() || secret.is_empty() {
        Err("The church's Canva integration credentials are not configured.".to_string())
    } else {
        Ok((id, secret))
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn read_tokens(app: &AppHandle) -> Result<Option<CanvaTokens>, String> {
    let Some(tokens): Option<CanvaTokens> =
        read_json_file(&canva_auth_path(app)).map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let configured_client_id = crate::commands::settings::load_library_settings(app)
        .map_err(|error| error.to_string())?
        .canva_integration
        .client_id;
    Ok((tokens.client_id == configured_client_id).then_some(tokens))
}

fn save_tokens(app: &AppHandle, response: TokenResponse) -> Result<(), String> {
    let auth_path = canva_auth_path(app);
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tokens = CanvaTokens {
        client_id: credentials(app)?.0,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: unix_now() + response.expires_in,
    };
    write_json_file(&auth_path, &tokens).map_err(|error| error.to_string())
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();
    result
        .map(|_| ())
        .map_err(|e| format!("Could not open Canva: {e}"))
}

async fn response_json(response: Response) -> Result<Value, String> {
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| {
                value["message"]
                    .as_str()
                    .or_else(|| value["error"]["message"].as_str())
                    .map(str::to_string)
            })
            .unwrap_or(body);
        if status == reqwest::StatusCode::FORBIDDEN
            && detail.contains("Not allowed to access design")
        {
            return Err(format!(
                "{detail}. Make sure you own this design and reconnect Canva so the current design-content permissions are granted."
            ));
        }
        return Err(format!("Canva returned {status}: {detail}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("Invalid response from Canva: {e}"))
}

async fn exchange_token(
    app: &AppHandle,
    fields: &[(&str, String)],
) -> Result<TokenResponse, String> {
    let (client_id, client_secret) = credentials(app)?;
    let response = Client::new()
        .post(format!("{API_ROOT}/oauth/token"))
        .basic_auth(client_id, Some(client_secret))
        .form(fields)
        .send()
        .await
        .map_err(|e| format!("Could not reach Canva: {e}"))?;
    let value = response_json(response).await?;
    serde_json::from_value(value).map_err(|e| format!("Invalid token response from Canva: {e}"))
}

async fn access_token(app: &AppHandle) -> Result<String, String> {
    let tokens =
        read_tokens(app)?.ok_or_else(|| "Connect this machine to Canva first.".to_string())?;
    if tokens.expires_at > unix_now() + 60 {
        return Ok(tokens.access_token);
    }
    let response = exchange_token(
        app,
        &[
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", tokens.refresh_token),
        ],
    )
    .await?;
    let access = response.access_token.clone();
    save_tokens(app, response)?;
    Ok(access)
}

async fn api_get(app: &AppHandle, path: &str) -> Result<Value, String> {
    let response = Client::new()
        .get(format!("{API_ROOT}{path}"))
        .bearer_auth(access_token(app).await?)
        .send()
        .await
        .map_err(|e| format!("Could not reach Canva: {e}"))?;
    response_json(response).await
}

async fn api_post(app: &AppHandle, path: &str, body: Value) -> Result<Value, String> {
    let response = Client::new()
        .post(format!("{API_ROOT}{path}"))
        .bearer_auth(access_token(app).await?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach Canva: {e}"))?;
    response_json(response).await
}

fn parse_design(value: &Value) -> Result<CanvaDesign, String> {
    Ok(CanvaDesign {
        id: value["id"]
            .as_str()
            .ok_or_else(|| "Canva design is missing an id.".to_string())?
            .to_string(),
        title: value["title"]
            .as_str()
            .unwrap_or("Untitled Canva design")
            .to_string(),
        edit_url: value["urls"]["edit_url"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        page_count: value["page_count"].as_u64().unwrap_or(1) as usize,
        thumbnail_url: value["thumbnail"]["url"].as_str().map(str::to_string),
    })
}

pub async fn complete_oauth(
    handle: &RemoteServerHandle,
    code: String,
    state: String,
) -> Result<(), String> {
    let pending = handle
        .take_canva_oauth(&state)
        .await
        .ok_or_else(|| "This Canva connection request is invalid or has expired.".to_string())?;
    let port = handle
        .canva_port()
        .ok_or_else(|| "The local callback server is not available yet.".to_string())?;
    let redirect_uri = format!("http://127.0.0.1:{port}/canva/callback");
    let response = exchange_token(
        &handle.app,
        &[
            ("grant_type", "authorization_code".to_string()),
            ("code", code),
            ("code_verifier", pending.code_verifier),
            ("redirect_uri", redirect_uri),
        ],
    )
    .await;
    match response {
        Ok(tokens) => {
            save_tokens(&handle.app, tokens)?;
            handle.set_canva_error(None).await;
            Ok(())
        }
        Err(error) => {
            handle.set_canva_error(Some(error.clone())).await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn get_canva_status(
    app: AppHandle,
    server: State<'_, RemoteServerHandle>,
) -> Result<CanvaStatus, String> {
    let configured = credentials(&app).is_ok();
    let server_status = server.canva_status().await;
    Ok(CanvaStatus {
        configured,
        connected: configured && read_tokens(&app)?.is_some(),
        connecting: server_status.0,
        error: server_status.1,
        callback_url: server
            .canva_port()
            .map(|port| format!("http://127.0.0.1:{port}/canva/callback")),
    })
}

#[tauri::command]
pub async fn connect_canva(
    app: AppHandle,
    server: State<'_, RemoteServerHandle>,
) -> Result<(), String> {
    let (client_id, _) = credentials(&app)?;
    let port = server
        .canva_port()
        .ok_or_else(|| "The local Canva callback server is not available yet.".to_string())?;
    let code_verifier = [
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
        uuid::Uuid::new_v4().to_string(),
    ]
    .concat();
    let state = uuid::Uuid::new_v4().to_string();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(code_verifier.as_bytes()));
    server
        .set_canva_oauth(CanvaOAuthPending {
            state: state.clone(),
            code_verifier,
        })
        .await;
    let redirect_uri = format!("http://127.0.0.1:{port}/canva/callback");
    let url = format!(
        "https://www.canva.com/api/oauth/authorize?code_challenge={challenge}&code_challenge_method=s256&scope={}&response_type=code&client_id={}&state={}&redirect_uri={}",
        percent_encode(SCOPES),
        percent_encode(&client_id),
        percent_encode(&state),
        percent_encode(&redirect_uri),
    );
    open_browser(&url)
}

#[tauri::command]
pub async fn disconnect_canva(
    app: AppHandle,
    server: State<'_, RemoteServerHandle>,
) -> Result<(), String> {
    delete_file_if_exists(&canva_auth_path(&app)).map_err(|error| error.to_string())?;
    server.clear_canva_oauth().await;
    Ok(())
}

#[tauri::command]
pub async fn list_canva_designs(app: AppHandle) -> Result<Vec<CanvaDesign>, String> {
    let value = api_get(
        &app,
        "/designs?ownership=owned&sort_by=modified_descending&limit=100",
    )
    .await?;
    value["items"]
        .as_array()
        .ok_or_else(|| "Canva did not return a design list.".to_string())?
        .iter()
        .map(parse_design)
        .collect()
}

#[tauri::command]
pub async fn create_canva_design(app: AppHandle, title: String) -> Result<CanvaDesign, String> {
    let value = api_post(
        &app,
        "/designs",
        json!({
            "type": "type_and_asset",
            "design_type": { "type": "custom", "width": 1920, "height": 1080 },
            "title": title,
        }),
    )
    .await?;
    parse_design(&value["design"])
}

#[tauri::command]
pub async fn open_canva_design(app: AppHandle, design_id: String) -> Result<(), String> {
    let value = api_get(&app, &format!("/designs/{design_id}")).await?;
    let design = parse_design(&value["design"])?;
    if design.edit_url.is_empty() {
        return Err("Canva did not provide an editing URL for this design.".to_string());
    }
    open_browser(&design.edit_url)
}

/// Starts a Canva export job for `design_id` in the given `format` and polls until it finishes,
/// returning the design metadata plus every resulting file URL. Shared by the image-preview and
/// video-export commands below — the job-creation/polling mechanics are identical, only the
/// `format` body and what's done with the URLs afterward differ.
async fn start_and_poll_export(
    app: &AppHandle,
    design_id: &str,
    format: Value,
) -> Result<(CanvaDesign, Vec<String>), String> {
    let design_value = api_get(app, &format!("/designs/{design_id}")).await?;
    let design = parse_design(&design_value["design"])?;
    let created = api_post(
        app,
        "/exports",
        json!({ "design_id": design_id, "format": format }),
    )
    .await?;
    let job_id = created["job"]["id"]
        .as_str()
        .ok_or_else(|| "Canva did not return an export job id.".to_string())?
        .to_string();

    let mut urls = None;
    for _ in 0..120 {
        let job = api_get(app, &format!("/exports/{job_id}")).await?;
        match job["job"]["status"].as_str() {
            Some("success") => {
                urls = Some(
                    job["job"]["urls"]
                        .as_array()
                        .ok_or_else(|| "Canva export completed without any files.".to_string())?
                        .iter()
                        .filter_map(|url| url.as_str().map(str::to_string))
                        .collect::<Vec<_>>(),
                );
                break;
            }
            Some("failed") => {
                let code = job["job"]["error"]["code"]
                    .as_str()
                    .unwrap_or("unknown error");
                return Err(format!("Canva could not export this design: {code}"));
            }
            _ => tokio::time::sleep(Duration::from_millis(750)).await,
        }
    }
    let urls = urls.ok_or_else(|| "Canva took too long to export this design.".to_string())?;
    if urls.is_empty() {
        return Err("Canva export completed without any files.".to_string());
    }
    Ok((design, urls))
}

/// Starts a Canva export job and waits for it to finish, returning each page's (temporary,
/// presigned) image URL without downloading or writing anything — lets the frontend show a page
/// picker before committing to actually importing any of them. `import_canva_pages` re-fetches
/// the design itself rather than trusting a client-supplied copy of it back.
#[tauri::command]
pub async fn preview_canva_design_export(
    app: AppHandle,
    design_id: String,
) -> Result<CanvaExportPreview, String> {
    let (design, urls) =
        start_and_poll_export(&app, &design_id, json!({ "type": "png", "lossless": true })).await?;
    Ok(CanvaExportPreview {
        design,
        pages: urls
            .into_iter()
            .enumerate()
            .map(|(index, export_url)| CanvaExportedPage {
                page_number: index + 1,
                export_url,
            })
            .collect(),
    })
}

/// Exports the whole design as one MP4 and downloads it to a temp file — deliberately no page
/// picker for this, unlike the per-page image flow: a video export has no natural "subset," it
/// either carries the design's real transitions/timing as one file or it doesn't. Omitting
/// `pages` from the export request exports every page; quality is a fixed 1080p/horizontal
/// default rather than a picker, since every design this app creates starts at that same 16:9
/// shape (`create_canva_design`). Requires the job to return exactly one file — Canva only
/// combines same-dimension pages into a single video, so a design with mismatched page sizes
/// surfaces as a clear error here instead of silently importing several untracked clips.
///
/// Stops short of importing it, unlike `import_canva_pages` for images: a video can be large
/// enough that which folder it lands in (synced vs. local-only) genuinely matters — put it in
/// the wrong one and a church computer that didn't make the export might never receive it over
/// sync — so the operator needs to see the real downloaded size and choose, the same way the
/// ordinary Import Media dialog already lets them override its own large-file default. This
/// returns that size plus an opaque `temp_path` (same "handle the frontend hands back at commit
/// time" pattern as `StagedMediaFile.path`) for `import_canva_video` to actually commit.
#[tauri::command]
pub async fn preview_canva_video_export(
    app: AppHandle,
    design_id: String,
) -> Result<CanvaVideoPreview, String> {
    let (design, urls) = start_and_poll_export(
        &app,
        &design_id,
        json!({ "type": "mp4", "quality": "horizontal_1080p", "export_quality": "regular" }),
    )
    .await?;
    if urls.len() > 1 {
        return Err(
            "This design's pages aren't all the same size, so Canva can't combine them into one video."
                .to_string(),
        );
    }

    let temp_dir = app_data_dir(&app).join("canva-import");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let bytes = Client::new()
        .get(&urls[0])
        .send()
        .await
        .map_err(|e| format!("Could not download the exported video: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Could not download the exported video: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Could not read the exported video: {e}"))?;
    let size_bytes = bytes.len() as u64;
    let temp_path = temp_dir.join(format!("{}.mp4", uuid::Uuid::new_v4()));
    fs::write(&temp_path, bytes).map_err(|e| e.to_string())?;

    Ok(CanvaVideoPreview {
        design,
        temp_path: temp_path.to_string_lossy().to_string(),
        size_bytes,
    })
}

/// Commits an already-downloaded video from `preview_canva_video_export` at the operator's
/// chosen `location` ("synced" | "local"). Re-fetches the design for its title rather than
/// trusting a client-supplied copy back, same reasoning as `import_canva_pages`. Only removes
/// its own `temp_path` on cleanup, not the whole shared `canva-import` temp dir — unlike the
/// single-shot image/video-preview commands, there can be a real gap (however long the operator
/// takes to choose synced vs. local) between this file landing on disk and this command running,
/// during which another in-flight preview's own temp file could exist alongside it.
#[tauri::command]
pub async fn import_canva_video(
    app: AppHandle,
    design_id: String,
    temp_path: String,
    location: String,
) -> Result<CanvaVideoExportResult, String> {
    let design_value = api_get(&app, &format!("/designs/{design_id}")).await?;
    let design = parse_design(&design_value["design"])?;

    let root = library_root(&app);
    let local_root = local_media_root(&app);
    let device = this_device_name(&app);
    let imported_at = now_iso();
    let filename = format!("{}.mp4", design.title);
    let title = design.title.clone();
    let description = Some(format!("Imported from Canva design {}", design.id));
    let tags = vec!["Canva".to_string()];

    let existing =
        media::find_by_canva_video_origin(&root, &design.id).map_err(|e| e.to_string())?;
    let item = match existing {
        // Keeps whatever location the existing item already has — same as the per-page image
        // refresh path, which also never reconsiders location on a later re-import.
        Some(existing) => media::replace_from_file(
            &root,
            &local_root,
            media::MediaReplacement {
                id: &existing.id,
                source: Path::new(&temp_path),
                title,
                description,
                tags,
            },
            &device,
            &imported_at,
        )
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "The existing media item for this video was removed.".to_string())?,
        None => {
            let mut created = media::commit_imports(
                &root,
                &local_root,
                vec![MediaImportCommit {
                    path: temp_path.clone(),
                    filename,
                    title,
                    description,
                    tags,
                    location,
                    duplicate_of_id: None,
                    id: None,
                    origin: Some(MediaOrigin::CanvaVideo {
                        design_id: design.id.clone(),
                    }),
                }],
                &device,
                &imported_at,
            )
            .map_err(|e| e.to_string())?;
            created
                .pop()
                .ok_or_else(|| "Canva export did not create a media record.".to_string())?
        }
    };
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&temp_path);
    Ok(CanvaVideoExportResult {
        design,
        media: item,
    })
}

/// Downloads and imports only the requested pages (already-exported URLs from
/// `preview_canva_design_export` — no new export job here). Each page is looked up by its Canva
/// origin (`media::find_by_canva_origin`) *across the whole media library*, not just whatever
/// slides the caller happens to know about — so re-importing a page already pulled in via a
/// different slide presentation, or via the Media Library's own "Import from Canva" entry
/// point, updates that same MediaItem instead of creating a duplicate, regardless of which UI
/// triggered either import.
#[tauri::command]
pub async fn import_canva_pages(
    app: AppHandle,
    design_id: String,
    pages: Vec<CanvaPageToImport>,
) -> Result<CanvaImportResult, String> {
    let design_value = api_get(&app, &format!("/designs/{design_id}")).await?;
    let design = parse_design(&design_value["design"])?;

    let temp_dir = app_data_dir(&app).join("canva-import");
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let client = Client::new();
    let root = library_root(&app);
    let local_root = local_media_root(&app);
    let device = this_device_name(&app);
    let imported_at = now_iso();
    let mut media_items = Vec::new();
    for page in &pages {
        let bytes = client
            .get(&page.export_url)
            .send()
            .await
            .map_err(|e| format!("Could not download Canva page {}: {e}", page.page_number))?
            .error_for_status()
            .map_err(|e| format!("Could not download Canva page {}: {e}", page.page_number))?
            .bytes()
            .await
            .map_err(|e| format!("Could not read Canva page {}: {e}", page.page_number))?;
        let filename = format!("{} - Page {}.png", design.title, page.page_number);
        let temp_path = temp_dir.join(format!("{}-{}.png", uuid::Uuid::new_v4(), page.page_number));
        fs::write(&temp_path, bytes).map_err(|e| e.to_string())?;
        let title = format!("{} - Page {}", design.title, page.page_number);
        let description = Some(format!("Imported from Canva design {}", design.id));
        let tags = vec!["Canva".to_string()];

        let existing = media::find_by_canva_origin(&root, &design.id, page.page_number)
            .map_err(|e| e.to_string())?;
        let item = match existing {
            Some(existing) => media::replace_from_file(
                &root,
                &local_root,
                media::MediaReplacement {
                    id: &existing.id,
                    source: &temp_path,
                    title,
                    description,
                    tags,
                },
                &device,
                &imported_at,
            )
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "The existing media item for this page was removed.".to_string())?,
            None => {
                let mut created = media::commit_imports(
                    &root,
                    &local_root,
                    vec![MediaImportCommit {
                        path: temp_path.to_string_lossy().to_string(),
                        filename,
                        title,
                        description,
                        tags,
                        location: "synced".to_string(),
                        duplicate_of_id: None,
                        id: None,
                        origin: Some(MediaOrigin::Canva {
                            design_id: design.id.clone(),
                            page_number: page.page_number,
                        }),
                    }],
                    &device,
                    &imported_at,
                )
                .map_err(|e| e.to_string())?;
                created
                    .pop()
                    .ok_or_else(|| "Canva import did not create a media record.".to_string())?
            }
        };
        media_items.push((page.page_number, item));
    }
    manifest::rebuild(&root).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&temp_dir);
    Ok(CanvaImportResult {
        design,
        pages: media_items
            .into_iter()
            .map(|(page_number, media)| CanvaImportedPage { page_number, media })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_protects_oauth_query_values() {
        assert_eq!(
            percent_encode("design:read one/two"),
            "design%3Aread%20one%2Ftwo"
        );
    }

    #[test]
    fn parse_design_reads_the_fields_used_by_the_editor() {
        let design = parse_design(&json!({
            "id": "D123",
            "title": "Sunday Welcome",
            "page_count": 3,
            "urls": { "edit_url": "https://www.canva.com/edit/123" },
            "thumbnail": { "url": "https://example.test/thumb.png" }
        }))
        .unwrap();
        assert_eq!(design.id, "D123");
        assert_eq!(design.title, "Sunday Welcome");
        assert_eq!(design.page_count, 3);
        assert_eq!(design.edit_url, "https://www.canva.com/edit/123");
    }
}
