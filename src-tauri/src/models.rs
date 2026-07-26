use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SongBlock {
    pub id: String,
    pub label: String,
    pub text: String,
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceItem {
    pub id: String,
    #[serde(flatten)]
    pub content: ServiceItemContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleAssignment {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volunteer_id: Option<String>,
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
pub struct Volunteer {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Not a restriction — just makes this volunteer show up first when filling roster
    /// fields for these roles (see design/sketches/volunteer-editor.html).
    #[serde(default)]
    pub preferred_roles: Vec<String>,
    #[serde(default)]
    pub unavailable_date_ranges: Vec<UnavailableDateRange>,
    pub updated_at: String,
    pub updated_by_device: String,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub date: String,
    #[serde(rename = "type")]
    pub service_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preacher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sermon_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_passage: Option<String>,
    #[serde(default)]
    pub items: Vec<ServiceItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presenter_notes: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volunteer_roster: Option<Vec<RoleAssignment>>,
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
    pub slides: Vec<SongBlock>,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BibleTranslationConfig {
    pub code: String,
    pub source: String,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    #[serde(default)]
    pub service_types: Vec<String>,
    #[serde(default)]
    pub preachers: Vec<String>,
    #[serde(default)]
    pub collections: Vec<String>,
    #[serde(default)]
    pub volunteer_roles: Vec<String>,
    pub branding: Branding,
    #[serde(default)]
    pub bible_translations: Vec<BibleTranslationConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_translation_code: Option<String>,
    pub media_max_synced_file_size_mb: u32,
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
