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
    /// A `SongCollectionDefinition.id` — despite the field name, this held the collection's
    /// plain *name* before the one-time migration in `commands::song_collections`; existing
    /// libraries get rewritten in place the first time that migration runs.
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
    /// Who this is known for/performed by, when that differs from `author` — shown in place of
    /// it wherever a song is being picked/browsed, but `author` stays what CCLI reporting uses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
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
    /// Hidden from the library list and the Add-to-Service song picker, but otherwise untouched
    /// — a past service that already references this song still resolves and renders it
    /// normally, and usage/CCLI reporting is unaffected. Reversible, unlike deleting.
    #[serde(default)]
    pub archived: bool,
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

/// One ordered, presentable step after a sermon's main passage. It refers to the canonical
/// passage or outline record instead of copying its scripture/display or slide content.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SermonFlowItem {
    Passage { passage_id: String },
    Outline { outline_id: String },
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
        #[serde(skip_serializing_if = "Option::is_none")]
        present_main_passage: Option<bool>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        flow: Vec<SermonFlowItem>,
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
    /// Optional per-service override for generated presentation slides. When absent, the
    /// default for the item's content type is resolved by the frontend.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_id: Option<String>,
    /// Who's doing this part (Elder leading prayer, scripture reader, etc.) — a `RoleDefinition`
    /// id from the same catalog Assignments uses (`domain::roles`), not a Person id directly:
    /// the actual person is whoever that service's Assignments has for this role, so assigning
    /// it there is what fills this in (and keeps conflict-detection/templates consistent).
    /// Optional and often absent — a "Silent Preparation" bulletin note, for example, needs no
    /// one assigned at all. For the sermon item this is how its preacher is resolved too — the
    /// same role/assignments mechanism as every other item type. Was named `role` and held the
    /// role's plain *name* before the one-time migration in `commands::roles`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
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
    /// Optional auto-advance/looping timer for this item's own generated slides (see
    /// notes/slide-auto-advance-plan.md) — only meaningful for TextSlide/SlideRef items (the
    /// frontend only exposes it there); ignored by every other type, including Song/Scripture/
    /// Sermon, which are normally paced live by whoever's leading them rather than a timer. A
    /// pure data passthrough here, same as every other ServiceItem field: the actual timer
    /// lives entirely in the frontend's live-transport composable, not on this side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_advance: Option<AutoAdvance>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoAdvance {
    pub interval_seconds: f64,
    /// `loop` is a Rust keyword, so the identifier differs from the wire field name.
    #[serde(rename = "loop")]
    pub looping: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleAssignment {
    /// A `RoleDefinition.id` — was named `role` and held the role's plain *name* before the
    /// one-time migration in `commands::roles`.
    pub role_id: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Not a restriction — just makes this person show up first when filling roles for
    /// these (see design/sketches/volunteer-editor.html). `RoleDefinition.id`s — was named
    /// `preferredRoles` and held role plain *names* before the one-time migration in
    /// `commands::roles`.
    #[serde(default)]
    pub preferred_role_ids: Vec<String>,
    #[serde(default)]
    pub unavailable_date_ranges: Vec<UnavailableDateRange>,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// A printed-bulletin announcement — deliberately separate from Slide Library announcement
/// slides, whose content is punchy/visual for on-screen display rather than the more detailed,
/// often forward-looking text a printed entry carries. Two visibility patterns (see the
/// frontend's utils/announcementVisibility.ts, which is the actual source of truth for the
/// display logic — this struct is pure storage): event-dated entries (`event_date` set) need no
/// `show_until`, since the event date itself is the natural stop-showing point; ongoing/standing
/// entries (no `event_date`) require an explicit `show_until`, enforced by the frontend's save
/// validation rather than this struct, since a single optional field serves both patterns.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Announcement {
    pub id: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_until: Option<String>,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// Lives in its own `role-groups.json`, a peer of `library-settings.json`, not a field on it —
/// see `domain::role_groups` and `commands::roles`'s one-time migration off the old
/// nested-in-settings shape (`RoleGroup { name, roles: Vec<String> }`, where a role was just a
/// bare string living inside whichever group's `roles` array contained it). A role group no
/// longer owns its member roles directly — see `RoleDefinition::group_id` below for the
/// many-to-one link, chosen so a role can be reassigned to a different group later without
/// losing its identity or any of its historical references.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleGroupDefinition {
    pub id: String,
    pub name: String,
}

/// Lives in its own `roles.json`, a peer of `library-settings.json` and `role-groups.json` — see
/// `domain::roles` and `commands::roles`'s one-time migration. Referenced by id from
/// `RoleAssignment::role_id`, `ServiceItem::role_id`, `ServiceTemplateItem::role_id`,
/// `Person::preferred_role_ids`, and `BulletinSettings::serving_schedule_role_ids` — not by name.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoleDefinition {
    pub id: String,
    pub name: String,
    /// The `RoleGroupDefinition.id` this role belongs to — many-to-one (a role belongs to
    /// exactly one group).
    pub group_id: String,
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
    /// Optional printed note carried into the generated service item. For BulletinNote entries,
    /// this is the item body; for content entries, it appears beneath the item in the bulletin.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Optional for content kinds, required for RoleOnly. A `RoleDefinition.id` — was named
    /// `role` and held the role's plain *name* before the one-time migration in
    /// `commands::roles`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_id: Option<String>,
    /// RoleOnly kind only, default 1 (e.g. 2 Greeters).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u32>,
}

/// Lives in its own `service-templates.json`, a peer of `library-settings.json` — see
/// `domain::service_templates` and `commands::service_templates`'s one-time migration off the
/// old nested-in-settings shape. An ordered shell for a service type — songs, scripture, sermon,
/// bulletin notes, role-only assignments — filled in once per church and applied at service
/// creation (see applyServiceTemplate on the frontend); never re-applied to already-created
/// services afterward. Order matters: items seed `Service::items` in this same order.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTemplate {
    pub id: String,
    /// The template's own name — a real, independent identity field. Was named `serviceType`
    /// and did double duty as both this template's display name *and* (before
    /// `default_for_service_type_ids` existed) an implicit link to the service type sharing
    /// that same name; the one-time migration in `commands::service_templates` splits that
    /// apart, leaving this purely a display name.
    pub name: String,
    /// Optional planning note explaining when this template should be used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `ServiceType.id`s that choose this template by default (was a list of service type
    /// *names* before the one-time migration in `commands::service_types` — see
    /// `Service::service_type_id`'s own doc comment for why).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_for_service_type_ids: Option<Vec<String>>,
    #[serde(default)]
    pub items: Vec<ServiceTemplateItem>,
}

/// The configured Audience display's current full bounds — computed fresh from the monitor
/// layout on every External App Hand-off launch (see the Tauri adapter's
/// computeAudienceMonitorPhysicalBounds), not stored anywhere. An external app's window is
/// always positioned to exactly fill this rect, full screen.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    /// The OS-reported monitor name — informational only (display purposes).
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
    pub updated_at: String,
    pub updated_by_device: String,
}

/// Persisted per-machine (never synced) — a paired phone/tablet only makes sense on the
/// machine it was paired against, since the HTTP server it talks to only runs there.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDevice {
    pub id: String,
    /// Owner in the synced people library. Older device records deserialize without one and
    /// are deliberately no longer authorized until paired again under a person.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    pub name: String,
    /// "view-only" | "full-control"
    pub access_level: String,
    /// The pairing/session secret embedded in the QR code and stored as the phone's cookie —
    /// never sent back to the operator UI once provisioned (see RemoteDeviceSummary).
    pub token: String,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// What management screens list. The token stays backend-only even when re-pairing; the command
/// generates the new QR code without exposing the stored secret as device data.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDeviceSummary {
    pub id: String,
    pub person_id: Option<String>,
    pub name: String,
    pub access_level: String,
}

impl From<&RemoteDevice> for RemoteDeviceSummary {
    fn from(device: &RemoteDevice) -> Self {
        Self {
            id: device.id.clone(),
            person_id: device.person_id.clone(),
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
    /// A `ServiceType.id` — was named `type` and held the service type's plain *name* before
    /// the one-time migration in `commands::service_types`; existing libraries get rewritten in
    /// place the first time that migration runs.
    #[serde(default)]
    pub service_type_id: String,
    /// Private planning context that does not appear in the order of worship.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_notes: Option<String>,
    /// Songs being considered or ordered during planning, separate from the service order.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_song_ids: Option<Vec<String>>,
    /// The template most recently applied to this service, for planning context. A
    /// `ServiceTemplate.id` — was named `serviceTemplateName` and held the template's plain
    /// *name* before the one-time migration in `commands::service_templates`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_template_id: Option<String>,
    #[serde(default)]
    pub items: Vec<ServiceItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presenter_notes: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignments: Option<Vec<RoleAssignment>>,
    /// This week's front-page (Order of Worship) bulletin footer quote — entered fresh each
    /// week; the footer's title is a church-wide choice (LibrarySettings::bulletin).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bulletin_page1_footer: Option<String>,
    /// This week's back-page (Announcements) bulletin footer quote.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bulletin_page2_footer: Option<String>,
    pub updated_at: String,
    pub updated_by_device: String,
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
    /// Default auto-advance/looping timer for this item's own slides (see
    /// notes/slide-auto-advance-plan.md), applied whenever this item is added to a service
    /// unless that ServiceItem sets its own auto_advance override (same shape, reused here
    /// rather than a separate type). Independent loop flag from the override: a library item
    /// can default to playing through once (e.g. a photo slideshow meant to show only once)
    /// just as easily as looping indefinitely (e.g. a pre-service announcement loop).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_advance: Option<AutoAdvance>,
    pub usage: Usage,
    pub updated_at: String,
    pub updated_by_device: String,
}

/// Where a MediaItem's file came from, if not a plain import — currently only Canva, but a real
/// tagged enum (not `serde_json::Value`, unlike `LibrarySlide.source`) because domain::media
/// needs to actually query this field (find_by_canva_origin), not just persist it losslessly.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum MediaOrigin {
    Canva {
        design_id: String,
        page_number: usize,
    },
    /// A whole-design MP4 export (find_by_canva_video_origin) — deliberately has no page_number:
    /// unlike the per-page image case, a video export is never a subset of pages, so there's
    /// nothing to disambiguate beyond which design it came from.
    CanvaVideo { design_id: String },
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<MediaOrigin>,
    pub usage: Usage,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    /// Solid color shown directly or behind an image/video background.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    /// Either a MediaItem id, or one of the sentinel values "brand-primary"/"brand-secondary"
    /// (resolved against LibrarySettings::branding rather than duplicating a color here) —
    /// absent means no background.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_id: Option<String>,
    pub font: String,
    pub text_color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_effect: Option<PresentationTextEffect>,
    /// Legacy flag used when loading a theme saved before configurable text effects.
    #[serde(default)]
    pub outline: bool,
    /// Content types this theme is intended for. Empty means generic/all generated content.
    /// "songs" | "scripture" | "sermon" | "text-slides"
    #[serde(default)]
    pub applies_to: Vec<String>,
    /// "songs" | "scripture" | "sermon" | "text-slides"
    #[serde(default)]
    pub use_as_default_for: Vec<String>,
    pub updated_at: String,
    pub updated_by_device: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresentationTextEffect {
    /// "none" | "outline" | "shadow" | "glow"
    pub r#type: String,
    pub color: String,
    pub size: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_y: Option<f64>,
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

/// One Canva Connect integration shared by every computer using this church library. The
/// integration identifies Worship Studio during OAuth token exchange; the access/refresh
/// tokens authorizing an individual Canva account remain in per-machine canva-auth.json.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CanvaIntegration {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
}

/// A Dropbox app registration owned by the church, used by the tablet (PWA) build to sync
/// directly against the church's Dropbox library over the Dropbox API — see the frontend's
/// adapters/tablet/ for the actual sync client, which this repo's Rust code never talks to
/// itself (only the tablet build does, entirely client-side). Unlike CanvaIntegration, there's
/// no secret field at all: the Dropbox app is registered as a PKCE "public client," which by
/// design has none.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DropboxIntegration {
    #[serde(default)]
    pub app_key: String,
}

/// A Microsoft Entra app registration owned by the church, used the same way DropboxIntegration
/// is — but for a tablet connecting to the church's OneDrive instead. Same "no secret field"
/// story: registered as the `spa` platform type, which by design accepts none.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveIntegration {
    #[serde(default)]
    pub client_id: String,
}

/// A church-chosen api.bible edition (e.g. NIV) — synced via LibrarySettings, same as the
/// api.bible *key* needed to actually resolve it (LibraryCredentials::api_bible_key). Both are
/// church-wide, not per-machine — every device planning or presenting for the same church should
/// resolve translations the same way.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiBibleTranslation {
    /// Short code used in the picker and stored on ServiceItem (e.g. "NIV") — distinct from
    /// api.bible's own `bibleId`, which is an opaque catalog id (e.g. "78a9f6124f344018-01").
    pub code: String,
    pub label: String,
    pub bible_id: String,
}

/// Lives in its own `credentials.json`, a peer of `library-settings.json` — see
/// `commands::settings::migrate_credentials_into_own_file` for the one-time migration off the
/// old nested-in-settings shape. Kept separate from the taxonomy/branding/tuning fields that stay
/// in `LibrarySettings` for two reasons: it shrinks the conflict surface for the
/// much-more-frequently-edited fields there, and it matches a security boundary the app already
/// draws elsewhere — the Canva OAuth access/refresh tokens produced *from* these credentials
/// already live in their own machine-local `canva-auth.json`, specifically because they're
/// sensitive; these being church-shared credentials sitting next to bulletin footer text was the
/// one place that reasoning hadn't been carried through yet. Eager, unlike service_types/
/// song_collections/service_templates (which only migrate when their own command runs) —
/// commands::canva and commands::scripture both read these values directly and early (Canva
/// connection status, scripture resolution), not only once someone happens to open Settings
/// first — see commands::roles's own doc comment for the same reasoning applied there.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCredentials {
    #[serde(default)]
    pub canva_integration: CanvaIntegration,
    #[serde(default)]
    pub dropbox_integration: DropboxIntegration,
    #[serde(default)]
    pub one_drive_integration: OneDriveIntegration,
    /// ESV API key (api.esv.org) — church-wide, synced, entered once in Settings > Bible
    /// Translations. `None`/missing means ESV isn't configured for this church; falls back to
    /// the ESV_API_KEY env var for local-dev convenience (see commands::scripture). Moved here
    /// from MachineSettings (pre-0.9) since the key belongs to the church's own api.esv.org
    /// account, not to any one computer — see MachineSettings::esv_api_key for the migration of
    /// an already-configured older install's key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub esv_api_key: Option<String>,
    /// api.bible key (scripture.api.bible) — church-wide, synced, same reasoning as
    /// esv_api_key above.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_bible_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
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
    /// Bulletin/Order of Worship export customization — every label here is this church's own
    /// choice, not a fixed English string (see frontend's orderOfWorship.ts/hopeHappenings.ts,
    /// which read these rather than hardcoding "Order of Worship"/"Heart Preparation"/etc.).
    #[serde(default)]
    pub bulletin: BulletinSettings,
}

/// Lives in its own `song-collections.json`, a peer of `library-settings.json`, not a field
/// on `LibrarySettings` — see `domain::song_collections` and `commands::song_collections`'s
/// one-time migration off the old nested-in-settings, name-only shape. Referenced by id from
/// `SongCollectionEntry::collection_id` (models::Song), not by name.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongCollectionDefinition {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abbreviation: Option<String>,
}

/// Lives in its own `service-types.json`, a peer of `library-settings.json`, not a field on it —
/// see `domain::service_types` and `commands::service_types`'s one-time migration off the old
/// nested-in-settings, name-only shape (mirrors `SongCollectionDefinition`'s own migration).
/// Referenced by id from `Service::service_type_id` and `ServiceTemplate::default_for_service_type_ids`,
/// not by name.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServiceType {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// See LibrarySettings::bulletin's own doc comment. `#[serde(default)]` per boolean field
/// (rather than only on the whole struct) means an old library-settings.json missing this
/// section entirely still gets these same "on" defaults via BulletinSettings::default() below —
/// the per-field defaults exist for the narrower case of a *partially* present bulletin object
/// (e.g. a future field added later that an older file predates).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BulletinSettings {
    #[serde(default = "default_bulletin_page1_title")]
    pub page1_title: String,
    #[serde(default = "default_bulletin_page2_title")]
    pub page2_title: String,
    #[serde(default = "default_bulletin_page1_footer_title")]
    pub page1_footer_title: String,
    #[serde(default = "default_bulletin_true")]
    pub page1_footer_enabled: bool,
    #[serde(default = "default_bulletin_page2_footer_title")]
    pub page2_footer_title: String,
    #[serde(default = "default_bulletin_true")]
    pub page2_footer_enabled: bool,
    #[serde(default = "default_bulletin_true")]
    pub page2_enabled: bool,
    #[serde(default = "default_bulletin_true")]
    pub show_announcements: bool,
    #[serde(default = "default_bulletin_true")]
    pub show_serving_schedule: bool,
    /// `RoleDefinition.id`s (e.g. "Nursery", "Sound Booth") that become columns in the serving
    /// schedule table — was named `servingScheduleRoles` and held role plain *names* before the
    /// one-time migration in `commands::roles`.
    #[serde(default)]
    pub serving_schedule_role_ids: Vec<String>,
}

impl Default for BulletinSettings {
    fn default() -> Self {
        Self {
            page1_title: default_bulletin_page1_title(),
            page2_title: default_bulletin_page2_title(),
            page1_footer_title: default_bulletin_page1_footer_title(),
            page1_footer_enabled: true,
            page2_footer_title: default_bulletin_page2_footer_title(),
            page2_footer_enabled: true,
            page2_enabled: true,
            show_announcements: true,
            show_serving_schedule: true,
            serving_schedule_role_ids: Vec::new(),
        }
    }
}

fn default_bulletin_true() -> bool {
    true
}

fn default_bulletin_page1_title() -> String {
    "Order of Worship".to_string()
}

fn default_bulletin_page2_title() -> String {
    "Announcements".to_string()
}

fn default_bulletin_page1_footer_title() -> String {
    "Heart Preparation".to_string()
}

fn default_bulletin_page2_footer_title() -> String {
    "Thought to Ponder".to_string()
}

fn default_scripture_min_font_size_px() -> u32 {
    72
}

fn default_scripture_max_font_size_px() -> u32 {
    120
}

fn default_song_min_font_size_px() -> u32 {
    16
}

fn default_song_max_font_size_px() -> u32 {
    120
}

fn default_slide_header_font_size_px() -> u32 {
    48
}

fn default_slide_footer_font_size_px() -> u32 {
    48
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
    /// Legacy ESV/api.bible keys, retained only so Settings can migrate installations that
    /// configured a key back when it was (mistakenly) treated as per-machine rather than
    /// church-wide — see LibraryCredentials::esv_api_key/api_bible_key for the real, synced
    /// fields, and commands::settings::migrate_legacy_bible_api_keys for the one-time move.
    /// New saves always clear these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub esv_api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_bible_key: Option<String>,
    /// Legacy Canva Connect credentials retained only so Settings can migrate installations
    /// created before the integration became church-wide. New saves always clear these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canva_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canva_client_secret: Option<String>,
    /// Explicit Remote Control LAN port. Missing means automatic selection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_control_port: Option<u16>,
    /// Explicit mDNS hostname label for Remote Control. Missing selects an installation-mode
    /// default (computer-based when installed, `worshipstudio-portable` when portable). The
    /// `.local` suffix is added by the server rather than stored here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_control_hostname: Option<String>,
    /// Last successful automatically selected port, kept stable across restarts when possible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_remote_control_port: Option<u16>,
    /// Exact loopback port registered as the Canva OAuth redirect for this installation.
    /// Missing selects an installation-mode default (47823 installed, 47824 portable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canva_callback_port: Option<u16>,
    /// Tablet-only (the PWA build's adapters/tablet/) — never read or written by this desktop
    /// app, which never has anything to sync into an OPFS cache. Present here only so the
    /// shared MachineSettings shape stays one-to-one with the frontend's TS model, same as
    /// remote_control_port/etc. already being desktop-only-meaningful fields on this struct.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tablet_media_max_cached_file_size_mb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tablet_cloud_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tablet_cloud_library_folder_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tablet_cloud_client_id: Option<String>,
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
    /// The raw MediaItem id — what the confidence-monitor mirror (src-remote/) actually uses,
    /// via its own `/api/media/:id` endpoint, since a `convertFileSrc` URL means nothing
    /// off-device.
    pub media_id: String,
    /// "image" | "video"
    pub kind: String,
    /// "cover" | "contain"
    pub fit: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LivePresentationTheme {
    pub font_family: String,
    pub text_color: String,
    pub text_effect: PresentationTextEffect,
    pub background_color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_media: Option<LiveMediaRef>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FontRange {
    pub min_px: f64,
    pub max_px: f64,
}

/// Mirrors the frontend's LiveSlideContent (src/adapters/types.ts) — the operator window
/// pushes this to Rust (see commands::remote::update_remote_live_state) whenever the live
/// slide changes, so the remote HTTP server's /api/state has something to report without the
/// server itself needing any awareness of songs/scripture/slides.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveSlideContent {
    pub item_label: String,
    pub sub_label: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentation_theme: Option<LivePresentationTheme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wayfinding_books: Option<Vec<WayfindingBook>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bible_progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<LiveMediaRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_range: Option<FontRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_wrap: Option<bool>,
    /// Empty string is meaningful (hide the footer rather than fall back to the block label) —
    /// distinct from `None` (no override at all) — do not treat "" as equivalent to absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_font_size_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer_font_size_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wayfinding_min_font_size_px: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wayfinding_max_font_size_px: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every field the frontend's LiveSlideContent (src/adapters/types.ts) can send must survive
    /// the Tauri IPC → Rust struct boundary intact — this struct previously lacked several of
    /// these fields entirely, silently dropping them before the remote HTTP server ever saw them.
    #[test]
    fn live_slide_content_round_trips_every_field_including_an_empty_footer_override() {
        let content = LiveSlideContent {
            item_label: "Amazing Grace".to_string(),
            sub_label: "Chorus".to_string(),
            text: "Amazing grace, how sweet the sound".to_string(),
            font_range: Some(FontRange {
                min_px: 28.0,
                max_px: 72.0,
            }),
            line_wrap: Some(true),
            // Empty string is meaningful (hide the footer), distinct from None — must survive
            // round-trip as Some(""), not collapse to None.
            footer_text: Some(String::new()),
            repeat_label: Some("2/2".to_string()),
            outline_title: Some("Point One".to_string()),
            header_font_size_px: Some(48.0),
            footer_font_size_px: Some(36.0),
            wayfinding_min_font_size_px: Some(56.0),
            wayfinding_max_font_size_px: Some(150.0),
            bible_progress: Some(0.42),
            ..Default::default()
        };
        let json = serde_json::to_string(&content).unwrap();
        let round_tripped: LiveSlideContent = serde_json::from_str(&json).unwrap();
        assert_eq!(round_tripped.font_range.unwrap().min_px, 28.0);
        assert_eq!(round_tripped.line_wrap, Some(true));
        assert_eq!(round_tripped.footer_text, Some(String::new()));
        assert_eq!(round_tripped.repeat_label.as_deref(), Some("2/2"));
        assert_eq!(round_tripped.outline_title.as_deref(), Some("Point One"));
        assert_eq!(round_tripped.header_font_size_px, Some(48.0));
        assert_eq!(round_tripped.footer_font_size_px, Some(36.0));
        assert_eq!(round_tripped.wayfinding_min_font_size_px, Some(56.0));
        assert_eq!(round_tripped.wayfinding_max_font_size_px, Some(150.0));
        assert_eq!(round_tripped.bible_progress, Some(0.42));
    }

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
        assert_eq!(settings.scripture_min_font_size_px, 72);
        assert_eq!(settings.scripture_max_font_size_px, 120);
        assert_eq!(settings.song_min_font_size_px, 16);
        assert_eq!(settings.song_max_font_size_px, 120);
        assert_eq!(settings.slide_header_font_size_px, 48);
        assert_eq!(settings.slide_footer_font_size_px, 48);
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
