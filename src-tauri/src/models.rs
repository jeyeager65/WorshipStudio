use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SongBlock {
    pub id: String,
    pub label: String,
    pub text: String,
}

/// serde_json::Value intentionally makes Rust persistence lossless without duplicating the
/// frontend renderer's discriminated element union in native code.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySlide {
    pub id: String,
    pub label: String,
    pub scene: serde_json::Value,
    pub source: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Arrangement {
    pub sequence: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongCollectionEntry {
    pub collection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    pub uses_past_year: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ccli: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copyright: Option<String>,
    #[serde(default)]
    pub collections: Vec<SongCollectionEntry>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub blocks: Vec<SongBlock>,
    pub default_arrangement: Arrangement,
    pub usage: Usage,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayMode {
    Full,
    ReferenceOnly,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum MediaFit {
    Cover,
    Contain,
}

/// One passage a sermon references — a sermon may cite several beyond its main one; only the
/// main passage (Sermon::main_passage_id) is printed in the Order of Worship, but every passage
/// here is presented on screen, in list order, ahead of the outline.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SermonPassage {
    pub id: String,
    pub reference: String,
    pub translation: String,
    pub display_mode: DisplayMode,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ServiceItemContent {
    Song {
        song_id: String,
        arrangement: Arrangement,
    },
    Scripture {
        reference: String,
        translation: String,
        display_mode: DisplayMode,
    },
    SlideRef {
        slide_id: String,
    },
    TextSlide {
        slides: Vec<SongBlock>,
    },
    Media {
        media_id: String,
        fit: MediaFit,
    },
    Video {
        media_id: String,
    },
    Audio {
        media_id: String,
    },
    ExternalApp {
        profile_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file: Option<String>,
    },
    Countdown {
        target_time: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    Qr {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    /// "Worship Through the Word" — presentable passage(s) plus an outline, positioned wherever
    /// it actually falls in the service rather than pinned to a fixed header. This item is the
    /// sole source of truth for the service's sermon (title/passage/preacher, the last via the
    /// shared `role` field on `ServiceItem`) — there is no separate service-level sermon summary.
    Sermon {
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default)]
        passages: Vec<SermonPassage>,
        main_passage_id: String,
        #[serde(default)]
        outline: Vec<SongBlock>,
    },
    /// A bulletin-only line (e.g. "Silent Preparation", a named prayer) — never presented on
    /// screen (see domain-side flattening); its heading/body are the shared bulletin_label/
    /// bulletin_note fields below, not fields of its own.
    BulletinNote {},
    /// A "this slot needs real content" stand-in inserted by a ServiceTemplate for any kind
    /// requiring something specific picked/typed (song, scripture, slide, media, sermon, etc) —
    /// replaced in place once filled in (see ServiceWorkspaceView's insertItem/replaceItemIndex).
    Placeholder {
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        suggested_tab: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceItem {
    pub id: String,
    #[serde(flatten)]
    pub content: ServiceItemContent,
    /// Who's doing this part (Elder leading prayer, scripture reader, etc.) — a role name from
    /// the same catalog Assignments uses (LibrarySettings::role_groups), not a Person id
    /// directly: the actual person is whoever that service's Assignments has for this role, so
    /// assigning it there is what fills this in (and keeps conflict-detection/templates
    /// consistent). Optional and often absent — a "Silent Preparation" bulletin note, for
    /// example, needs no one assigned at all. For the sermon item this is how its preacher is
    /// resolved too — the same role/assignments mechanism as every other item type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Overrides this item's default Order of Worship heading (e.g. Scripture's hardcoded
    /// "Scripture Reading:" becomes "Scriptural Call to Worship:"; a song, which has no default
    /// label at all, can be given one like "Tithes and Offerings:").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bulletin_label: Option<String>,
    /// An optional second line under this item's Order of Worship entry (e.g. "(after this song
    /// children up to grade 4 can be dismissed to a children's lesson)") — the operator types
    /// the full text themselves; nothing here is auto-punctuated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bulletin_note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleAssignment {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    pub tentative: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableDateRange {
    pub start: String,
    pub end: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    /// How this person's name should appear elsewhere in the app (e.g. "Mike Smith" for
    /// Michael Smith, or "Pastor Dan" for Daniel Renno) — falls back to first + last name
    /// when unset (see personDisplayName on the frontend).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Not a restriction — just makes this person show up first when filling roles for
    /// these (see design/sketches/volunteer-editor.html).
    #[serde(default)]
    pub preferred_roles: Vec<String>,
    #[serde(default)]
    pub unavailable_date_ranges: Vec<UnavailableDateRange>,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// A named category of roles (e.g. "Praise Team" grouping Drums/Guitar/Piano/Vocals) — purely
/// organizational, since a role itself is still just a plain string referenced by
/// RoleAssignment::role/ServiceTemplateItem::role.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleGroup {
    pub name: String,
    #[serde(default)]
    pub roles: Vec<String>,
}

/// What a single ServiceTemplate entry seeds when a new service is created from its template:
/// either a real order-of-service item (with a placeholder standing in for content that must be
/// picked/typed) or, for `RoleOnly`, just a RoleAssignment row with no line in the order of
/// service at all (e.g. "2 Greeters").
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceTemplateItemKind {
    BulletinNote,
    Sermon,
    Song,
    Scripture,
    Slide,
    Media,
    Other,
    RoleOnly,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTemplateItem {
    pub id: String,
    pub kind: ServiceTemplateItemKind,
    /// Bulletin heading / placeholder description (e.g. "Opening Song") / RoleOnly's own display
    /// label.
    pub label: String,
    /// BulletinNote kind only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Optional for content kinds, required for RoleOnly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// RoleOnly kind only, default 1 (e.g. 2 Greeters).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

/// An ordered shell for a service type — songs, scripture, sermon, bulletin notes, role-only
/// assignments — filled in once per church and applied at service creation (see
/// applyServiceTemplate on the frontend); never re-applied to already-created services
/// afterward. Order matters: items seed `Service::items` in this same order.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTemplate {
    pub service_type: String,
    /// Service types that choose this template by default. None preserves the legacy behavior
    /// where a template defaults to the service type with the same name; Some(empty) explicitly
    /// means this template is not a default for any type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_for_service_types: Option<Vec<String>>,
    #[serde(default)]
    pub items: Vec<ServiceTemplateItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    /// The OS-reported monitor name this position was captured on — informational only
    /// (display purposes), not re-validated against current hardware before positioning.
    pub monitor_id: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Per-machine, not synced (see MachineSettings — executable paths like `C:\Program Files\...`
/// are local to that computer, meaningless elsewhere). Stored in its own file
/// (external-apps.json) rather than as a MachineSettings field since it's a growing list of
/// records, not a scalar.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAppProfile {
    pub id: String,
    pub name: String,
    /// "already-running" | "launch-automatically"
    pub launch_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    /// Contains a literal `{file}` placeholder, substituted with the file chosen when this
    /// profile is added to a specific service — never baked into the profile itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_format: Option<String>,
    #[serde(default)]
    pub remote_controls_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_position: Option<WindowPosition>,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// Persisted per-machine (never synced) — a paired phone/tablet only makes sense on the
/// machine it was paired against, since the HTTP server it talks to only runs there.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDevice {
    pub id: String,
    pub name: String,
    /// "view-only" | "advance-only" | "full-control"
    pub access_level: String,
    /// The pairing/session secret embedded in the QR code and stored as the phone's cookie —
    /// never sent back to the operator UI once provisioned (see RemoteDeviceSummary).
    pub token: String,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// What the Settings > Remote Control management screen actually lists — the token is
/// deliberately omitted; the screen only ever needs to list devices and revoke them, never
/// re-display a secret already handed out via the original QR code.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDeviceSummary {
    pub id: String,
    pub name: String,
    pub access_level: String,
}

impl From<&RemoteDevice> for RemoteDeviceSummary {
    fn from(device: &RemoteDevice) -> Self {
        Self {
            id: device.id.clone(),
            name: device.name.clone(),
            access_level: device.access_level.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub date: String,
    /// Local service start time in 24-hour HH:mm form. Optional for older service files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    #[serde(rename = "type")]
    pub service_type: String,
    #[serde(default)]
    pub items: Vec<ServiceItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presenter_notes: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignments: Option<Vec<RoleAssignment>>,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CountdownOverlay {
    pub target_time: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoopConfig {
    pub enabled: bool,
    pub seconds_per_slide: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub countdown_overlay: Option<CountdownOverlay>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SlideLibraryItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub document_version: u32,
    #[serde(default)]
    pub slides: Vec<LibrarySlide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_id: Option<String>,
    #[serde(rename = "loop", skip_serializing_if = "Option::is_none")]
    pub loop_config: Option<LoopConfig>,
    pub usage: Usage,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub filename: String,
    /// Required, unlike filename — the human-facing label everywhere this item is shown.
    /// Defaults to empty for files saved before this field existed; domain::media normalizes
    /// that (deriving one from the filename) on read rather than here, since a default fn has
    /// no access to this item's own filename to derive from.
    #[serde(default)]
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// "image" | "video" — a plain string rather than an enum, same convention as
    /// `service_type`/`location` elsewhere in this file for simple open-ended value sets.
    pub kind: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// "synced" | "local" — see MachineSettings::local_media_path.
    pub location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_of_id: Option<String>,
    /// Non-cryptographic content hash (see domain::media::hash_file) used only to notice
    /// accidental duplicate imports, not for integrity/security.
    pub content_hash: String,
    pub usage: Usage,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    /// Either a MediaItem id, or one of the sentinel values "brand-primary"/"brand-secondary"
    /// (resolved against LibrarySettings::branding rather than duplicating a color here) —
    /// absent means no background.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_id: Option<String>,
    pub font: String,
    pub text_color: String,
    #[serde(default)]
    pub outline: bool,
    /// "songs" | "scripture" | "announcements" | "welcome-closing"
    #[serde(default)]
    pub use_as_default_for: Vec<String>,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Branding {
    pub church_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_media_id: Option<String>,
    pub primary_color: String,
    pub secondary_color: String,
}

/// A church-chosen api.bible edition (e.g. NIV) — synced via LibrarySettings so every machine
/// agrees on what "NIV" refers to, even though the api.bible *key* needed to actually resolve
/// it lives per-machine in MachineSettings (see MachineSettings::api_bible_key).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiBibleTranslation {
    /// Short code used in the picker and stored on ServiceItem (e.g. "NIV") — distinct from
    /// api.bible's own `bibleId`, which is an opaque catalog id (e.g. "78a9f6124f344018-01").
    pub code: String,
    pub label: String,
    pub bible_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    #[serde(default)]
    pub service_types: Vec<String>,
    #[serde(default)]
    pub collections: Vec<String>,
    #[serde(default)]
    pub role_groups: Vec<RoleGroup>,
    #[serde(default)]
    pub service_templates: Vec<ServiceTemplate>,
    pub branding: Branding,
    #[serde(default)]
    pub api_bible_translations: Vec<ApiBibleTranslation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_translation_code: Option<String>,
    pub media_max_synced_file_size_mb: u32,
    /// Scripture slides auto-fit as large as possible within this range (never below the
    /// minimum — a passage that still doesn't fit at minimum size splits across slides at
    /// verse boundaries instead of shrinking further). Defaults match the size range the
    /// static CSS clamp used before this was configurable.
    #[serde(default = "default_scripture_min_font_size_px")]
    pub scripture_min_font_size_px: u32,
    #[serde(default = "default_scripture_max_font_size_px")]
    pub scripture_max_font_size_px: u32,
    /// Song lyric slides auto-fit as large as possible within this range, shrinking to fit
    /// the whole block on one slide (a block is already the atomic unit a worship leader
    /// chose, so unlike scripture it never auto-splits across slides). Unlike scripture, a
    /// line that still doesn't fit at the minimum size is left as-is rather than wrapped at a
    /// word boundary — see utils/textAutoFit.ts's wrapLineAtPunctuation on the frontend.
    #[serde(default = "default_song_min_font_size_px")]
    pub song_min_font_size_px: u32,
    #[serde(default = "default_song_max_font_size_px")]
    pub song_max_font_size_px: u32,
    /// Slide header (the reference/title above the text, e.g. "John 3:16-17") and footer (the
    /// translation/sub-label below it, e.g. "ESV") — fixed position, fixed size, unlike the
    /// auto-fit main text, so they don't move or resize as the main text shrinks/grows.
    #[serde(default = "default_slide_header_font_size_px")]
    pub slide_header_font_size_px: u32,
    #[serde(default = "default_slide_footer_font_size_px")]
    pub slide_footer_font_size_px: u32,
    /// Reference-only scripture display's "wayfinding" visual (surrounding book names fading
    /// out toward the edges, centered on the reference itself) — the reference and nearest book
    /// approach the max size, the farthest book shown uses the min, everything between is
    /// linearly interpolated by distance. Unlike scripture/song, there's no auto-fit shrink-to-
    /// fit safety net for this text.
    #[serde(default = "default_wayfinding_min_font_size_px")]
    pub wayfinding_min_font_size_px: u32,
    #[serde(default = "default_wayfinding_max_font_size_px")]
    pub wayfinding_max_font_size_px: u32,
}

fn default_scripture_min_font_size_px() -> u32 {
    28
}

fn default_scripture_max_font_size_px() -> u32 {
    72
}

fn default_song_min_font_size_px() -> u32 {
    16
}

fn default_song_max_font_size_px() -> u32 {
    72
}

fn default_slide_header_font_size_px() -> u32 {
    24
}

fn default_slide_footer_font_size_px() -> u32 {
    24
}

fn default_wayfinding_min_font_size_px() -> u32 {
    56
}

fn default_wayfinding_max_font_size_px() -> u32 {
    150
}

/// api.bible sends an explicit JSON `null` for some entries' `description` (not merely an
/// absent field), which `#[serde(default)]` alone doesn't cover for a plain `String` — so this
/// treats both "missing" and "null" as empty.
fn empty_string_if_null<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

/// One entry from api.bible's `/v1/bibles` catalog — surfaced to Settings so a church picks a
/// real edition (e.g. NIV) rather than typing an arbitrary, unvalidated code.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiBibleCatalogEntry {
    pub id: String,
    pub name: String,
    pub abbreviation: String,
    /// api.bible often lists multiple distinct editions (different canons/licensors) sharing
    /// the exact same name and abbreviation (e.g. four "World English Bible" entries —
    /// Protestant/Catholic/Orthodox/Ecumenical) — this is the only field that tells them apart.
    #[serde(default, deserialize_with = "empty_string_if_null")]
    pub description: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MachineSettings {
    pub this_computer_name: String,
    pub dark_mode: bool,
    /// Local filesystem path to the synced library root on this machine.
    pub library_path: String,
    /// Whether the First-Time Setup Wizard has been completed or explicitly skipped on this
    /// machine. Defaults to false for machine-settings.json files written before this field
    /// existed, so upgrading an existing install re-offers the wizard exactly once rather than
    /// silently assuming it was already done.
    #[serde(default)]
    pub has_completed_setup: bool,
    /// Local-only media folder (per-machine, never synced) — for video loops etc. too large
    /// to be worth Dropbox-syncing to every machine (see design/feature-spec.md's Media
    /// Library section). Empty for machine-settings.json files written before this field
    /// existed; domain::media::local_media_root falls back to a default location for those.
    #[serde(default)]
    pub local_media_path: String,
    /// Persisted Display Setup role per monitor (keyed by the OS-reported monitor name, since
    /// that's the one thing stable across launches — see adapters/tauri's `displays` port,
    /// which does its own real monitor enumeration rather than a Rust command). Values are
    /// "operator" | "audience" | "not-used"; a monitor with no entry here defaults to
    /// "not-used" in the UI.
    #[serde(default)]
    pub display_roles: std::collections::HashMap<String, String>,
    /// ESV API key (api.esv.org) — per-machine, never synced, entered in Settings > Bible
    /// Translations. `None`/missing means ESV isn't configured on this machine; falls back to
    /// the ESV_API_KEY env var for local-dev convenience (see commands::scripture).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub esv_api_key: Option<String>,
    /// api.bible key (scripture.api.bible) — per-machine, never synced, same reasoning as
    /// esv_api_key above.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_bible_key: Option<String>,
    /// Canva Connect API credentials. These are deliberately machine-local and are never
    /// written into the synced library.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canva_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canva_client_secret: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BibleBookRef {
    pub name: String,
    pub abbr: String,
    /// Verse count per chapter — index 0 is chapter 1.
    pub chapters: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptureReference {
    pub book: String,
    pub start_chapter: u32,
    pub start_verse: u32,
    pub end_chapter: u32,
    pub end_verse: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScripturePassageVerse {
    pub number: u32,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScripturePassage {
    pub reference: String,
    pub translation: String,
    pub verses: Vec<ScripturePassageVerse>,
    /// Short attribution/copyright notice (e.g. ESV's required "(ESV)" line) — present when
    /// the source translation requires it be displayed alongside the text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copyright: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScriptureTranslation {
    pub code: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WayfindingBook {
    pub name: String,
    pub distance: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiveMediaRef {
    /// A `convertFileSrc` URL — only meaningful inside this app's own webviews (the operator
    /// window's own live-content display), never reachable from a phone's browser.
    pub url: String,
    /// The raw MediaItem id — what the confidence-monitor mirror (remote_page.html) actually
    /// uses, via its own `/api/media/:id` endpoint, since a `convertFileSrc` URL means nothing
    /// off-device.
    pub media_id: String,
    /// "image" | "video"
    pub kind: String,
    /// "cover" | "contain"
    pub fit: String,
}

/// Mirrors the frontend's LiveSlideContent (src/adapters/types.ts) — the operator window
/// pushes this to Rust (see commands::remote::update_remote_live_state) whenever the live
/// slide changes, so the remote HTTP server's /api/state has something to report without the
/// server itself needing any awareness of songs/scripture/slides.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiveCountdownRef {
    pub target_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveSlideContent {
    pub item_label: String,
    pub sub_label: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wayfinding_books: Option<Vec<WayfindingBook>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<LiveMediaRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub countdown: Option<LiveCountdownRef>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A library-settings.json written before scriptureMin/MaxFontSizePx existed must still
    /// load, defaulting to the same range the old static CSS clamp used — this is a real,
    /// already-in-production file shape (see the actual file on disk during development),
    /// not a hypothetical.
    #[test]
    fn library_settings_defaults_scripture_font_range_when_missing_from_disk() {
        let json = r##"{
            "serviceTypes": ["Sunday Morning Worship"],
            "collections": [],
            "roleGroups": [],
            "serviceTemplates": [],
            "branding": { "churchName": "", "primaryColor": "#1F3A5F", "secondaryColor": "#C9A227" },
            "apiBibleTranslations": [],
            "defaultTranslationCode": "KJV",
            "mediaMaxSyncedFileSizeMb": 50
        }"##;
        let settings: LibrarySettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.scripture_min_font_size_px, 28);
        assert_eq!(settings.scripture_max_font_size_px, 72);
        assert_eq!(settings.song_min_font_size_px, 16);
        assert_eq!(settings.song_max_font_size_px, 72);
        assert_eq!(settings.slide_header_font_size_px, 24);
        assert_eq!(settings.slide_footer_font_size_px, 24);
        assert_eq!(settings.wayfinding_min_font_size_px, 56);
        assert_eq!(settings.wayfinding_max_font_size_px, 150);
    }

    #[test]
    fn slide_library_item_defaults_tags_for_older_files() {
        let json = r#"{
            "id": "slides-1",
            "label": "Announcements",
            "documentVersion": 2,
            "slides": [],
            "usage": { "usesPastYear": 0 },
            "updatedAt": "",
            "updatedByDevice": ""
        }"#;
        let item: SlideLibraryItem = serde_json::from_str(json).unwrap();
        assert!(item.tags.is_empty());
    }
}
