# Web-Only Feature Parity — Research Notes

**Status: exploratory only, not a commitment.** This document exists to answer "how close could a web-only build get to the Tauri app, and what would it take?" It is not a plan and nothing here is scheduled.

## TL;DR

- **Window Management API**: Genuinely promising for the second-monitor presentation window, but Chromium-only (Chrome/Edge — not Firefox/Safari) and needs a one-time permission grant per browser profile. Would need to verify current spec/support before relying on it. See [§2](#2-window-management-api--the-second-monitor-question).
- **Bible APIs**: The local KJV dataset already works in the browser demo today — no gap there. ESV/api.bible only need to stay out of the *public* demo if the key is a **shared secret baked into the shipped bundle** — a **per-user key entered via Settings and kept in that browser's own `localStorage`** is a different, much lower-risk case (same trust model as the desktop build's local settings file) and could plausibly work even on the public demo. The one real unverified unknown is **CORS** — whether the providers allow direct browser calls at all, independent of where the key lives. See [§3](#3-bible-apis).
- **External apps**: Correct assumption — not possible. Browsers have no capability to launch or control other native applications; that's not a missing API, it's the sandbox working as designed. See [§4](#4-external-app-hand-off).
- **The bigger gap nobody asked about**: the desktop app has no server — it reads/writes plain JSON files in a Dropbox-synced folder. The demo only has `localStorage` sample data today, but the **File System Access API** (`showDirectoryPicker()`, Chromium-only) could let a web build read/write that *same* real folder directly — no backend needed, and it turns out the desktop app's conflict detection is already poll-based rather than relying on OS file-watching, so nothing is lost in translation. This is arguably the most promising single finding in this document. See [§5](#5-the-bigger-gap-theres-no-backend).

---

## 1. What "web-only" means today vs. what it would need to mean

Worth separating two things that sound similar but aren't:

1. **The GitHub Pages demo that exists right now** (published by [`.github/workflows/release.yml`](../.github/workflows/release.yml) on every release) — a static, public, read-only-in-spirit showcase. It runs the **mock adapter** (`src/adapters/mock/index.ts`) against `localStorage` and seeded fixture data. It was explicitly scoped in [`design/feature-spec.md`](../design/feature-spec.md) §7 to fake anything native: *"real second-monitor fullscreen output (shown as a simulated 'audience display' preview panel instead), External App Hand-off (...shows a mock message), real Dropbox sync (...fakeable), real email sending (...doesn't actually send it)."* It was never meant to be a production tool — it's a clickable pitch deck for the pastor and other non-technical people.

2. **A hypothetical production-capable web build** — something a church could actually run a real service from, with a real song library, real scripture lookups, and real second-screen output. This doesn't exist in any form today, and it's a much bigger lift than swapping in the Window Management API, because the whole storage model (§5) assumes a real filesystem.

Your two questions (Window Management, Bible APIs) are really about #2. The answer differs a lot depending on whether "web-only" still means "public demo anyone can open" (where the ESV key problem is real and unavoidable) or "a web build the church deploys/hosts for itself" (where it isn't).

---

## 2. Window Management API — the second-monitor question

**Short answer: plausible, with real caveats.** This is the most interesting finding of this research — it's not something the codebase's own spec notes (§7 of the feature spec) considered; they wrote off multi-monitor output as demo-only, simulated with a preview panel, because at the time the assumption was "that's just what Tauri is for."

### What the Tauri build does today

`openPresentationWindow()` (`src/adapters/tauri/index.ts:136-160`) creates a real second OS window (`WebviewWindow`), sized and positioned to exactly cover a specific monitor's bounds, fullscreen and undecorated. Which monitor it targets is decided by `findAssignedAudienceMonitor()` (`src/adapters/tauri/index.ts:86-98`), using `availableMonitors()`/`currentMonitor()` from `@tauri-apps/api/window`, matched against a monitor role (`operator`/`audience`/`not-used`) the user assigned once in Settings and persisted by the monitor's OS-reported name. Content is pushed to that window over Tauri's `emit`/`listen` event bus.

### What the browser's Window Management API offers

The [Window Management API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API) (`navigator.getScreenDetails()`) covers the same shape of problem:

- `getScreenDetails()` returns a `ScreenDetails` object with a `screens` array — each entry has position (`left`/`top`), size, `availLeft`/`availTop`/`availWidth`/`availHeight`, `isPrimary`, `isInternal`, and a human-readable `label` (e.g. a monitor's actual name — the same "identify which display is which" problem the app's `identify()` action solves today would map directly onto this).
- A same-origin popup opened via `window.open()` can be positioned on a specific screen using that screen's `left`/`top`/`width`/`height`.
- The Fullscreen API has been extended so `element.requestFullscreen({ screen })` can fullscreen a specific element **on a specific chosen screen**, rather than just "fullscreen wherever the window already is" — this is the piece that makes borderless full-screen audience output on a second monitor actually achievable from a browser tab.
- Cross-window messaging (equivalent to Tauri's `emit`/`listen`) is trivial and native to the browser: `BroadcastChannel` (same-origin, no server round-trip) does exactly this job.

So structurally: `getScreenDetails()` → pick the non-primary screen → `window.open()` a popup positioned there → `requestFullscreen({ screen })` inside it → drive its content over `BroadcastChannel` — is a real, close analogue to the current Tauri flow, and would let the *operator* and *audience* window be two same-origin browser tabs/windows instead of two Tauri webviews.

### Caveats that matter before treating this as "solved"

- **Chromium-only, but genuinely cross-OS within that.** This is a "Project Fugu" capability API (Chrome/Edge 100+) — Firefox and Safari have not shipped it, but confirmed via caniuse: there's no OS carve-out in Chrome's own support, it works the same on macOS as Windows. Moot in practice here, though — `design/feature-spec.md` §7 already scopes live presentation as Windows-only regardless of browser, so this API's core use case (audience-monitor fullscreen output) was never going to run on the Mac build anyway.
- **macOS returns weaker screen labels.** Browsers are explicitly allowed to return generic or empty `ScreenDetailed.label` strings, and macOS is more conservative than Windows about exposing display names to the browser. That only affects the "nice to have" identify-a-monitor UI text — the actual placement mechanic (screen count, position, size, `requestFullscreen({ screen })`) uses bounds, not labels, so it's unaffected. (This is a separate permission system from macOS's native Screen Recording privacy toggle, worth not conflating the two.)
- **Requires HTTPS** (a secure context) and an explicit permission prompt (`window-management` in the Permissions API) — the user has to grant it, though Chrome supports persisting that grant so it isn't re-prompted every service.
- **Requires a user gesture** to open the popup and request fullscreen — fine for a one-time "start presenting" click, not something that can happen silently on page load.
- **Popup blockers** can interfere unless the grant/flow is set up carefully; worth prototyping rather than assuming it'll be frictionless.
- **No decorations/always-on-top guarantees.** A borderless popup gets you most of the way, but browsers don't offer the same low-level window control Tauri's `decorations`/`skipTaskbar`/`resizable: false` flags do. In practice the audience monitor is usually left alone by the operator once started, so this is probably a non-issue, but it's not identical.
- **The Windows-only "External App Hand-off" positioning trick** (`computeAudienceMonitorPhysicalBounds()` feeding raw Win32 `SetWindowPos` calls, `src/adapters/tauri/index.ts:120-134`) has no browser equivalent at all — see §4, this is really about *other* apps, not the app's own window, so it's a separate concern from the above.

**Bottom line**: if a web build only needs to put *its own* content full-screen on a second monitor (the core "audience display" feature), the Window Management API is a legitimate path, with the tradeoff that it commits the church to Chrome/Edge as "the" browser on the presentation machine — which is a much smaller ask than it sounds, since desktop apps already implicitly commit to a specific machine/OS anyway.

---

## 3. Bible APIs

Three tiers exist today, and the picture is better than "assume it's blocked":

| Source | Tauri build | Web demo (public GitHub Pages) | Blocking reason |
|---|---|---|---|
| Local KJV dataset | `src-tauri/src/data/kjv.json`, compiled in via `include_str!` (`src-tauri/src/domain/scripture.rs:24-26`) | **Already works** — the same dataset is duplicated at `src/adapters/mock/kjvFull.json` and resolved client-side (`src/adapters/mock/index.ts:330-355`) | none — no gap |
| ESV API (`api.esv.org`) | `resolve_esv()`, `src-tauri/src/domain/scripture.rs:290`, via `reqwest` + a per-machine API key | Not available (`listTranslations()` only ever returns KJV) | See below — the current code comment overstates the blocker |
| api.bible (`api.scripture.api.bible`) | `resolve_api_bible()`, `src-tauri/src/domain/scripture.rs:447` | Not available (`listApiBibleCatalog()` returns `[]`) | Same as ESV |

Both network APIs are plain HTTPS JSON endpoints — nothing about them is native/Tauri-specific.

### The storage-location distinction matters here

The existing code comment (`src/adapters/mock/index.ts:356-361`) says a key "would have to live client-side, which the publicly-hosted static demo must never do." That's conflating two different things, worth separating:

- **A shared secret baked into the shipped bundle** — a WorshipStudio-owned key hardcoded at build time and committed into the public repo/build output. This genuinely must never happen: it would leak to the entire internet the moment the demo is built, since anyone can read a static site's shipped JS.
- **A per-user key, entered through the Settings UI at runtime and stored in that browser's own `localStorage`.** This never appears in the shipped bundle or the repo at all — it's scoped to one browser profile, exactly like the desktop build already scopes the key to `MachineSettings.esv_api_key` in a local, unencrypted settings file only that machine can read (`src-tauri/src/commands/scripture.rs:8-15`). There's no reason this is meaningfully riskier than what the desktop app already does today. Each user (or each church) would just bring their own key, the same way each desktop install already does.

So this **is** workable, including on the public demo, as long as it's "type in your own key" rather than "the demo ships with one baked in."

### The actual open question: CORS

Independent of where the key lives, a browser calling `api.esv.org` or `api.scripture.api.bible` directly needs those servers to return CORS headers permitting a different-origin request — otherwise the browser blocks the response regardless of how the key is stored, and a small server-side proxy would be needed instead (holding the key server-side and forwarding the request — a much smaller piece of infrastructure than a full backend, see §5). I checked both providers' public docs and neither states a CORS policy one way or the other — this needs an actual empirical test (a `fetch()` call from a browser console) rather than trusting documentation, before assuming either path.

**Bottom line**: local KJV needs no changes. ESV/api.bible are likely workable with user-supplied keys in `localStorage` even on the public demo — *if* CORS cooperates; if it doesn't, a thin proxy closes the gap without requiring the full backend described in §5.

---

## 4. External App Hand-off

Confirmed: **not possible, and this isn't a gap that closes with a better API** — it's a sandboxing boundary, not a missing feature.

The current feature (`src-tauri/src/domain/win32.rs`, `src-tauri/src/commands/external_apps.rs`) uses raw Win32 calls — `EnumWindows`, `SetForegroundWindow`, `SetWindowPos`, `SendInput` — to find, position, and send keystrokes to an arbitrary other Windows application (e.g. handing the audience monitor over to PowerPoint mid-service). Browsers deliberately provide **no API surface** for:
- Enumerating other running processes or their windows
- Launching an arbitrary executable
- Sending synthetic input to another application
- Positioning/focusing windows that don't belong to the page itself

This is a fundamental part of the browser security model (a web page cannot be allowed to act on other applications on your machine), not a capability gap that a future spec might fill. A web build would have to drop this feature entirely, or fake it the way the mock adapter already does (`src/adapters/mock/index.ts:390` — intentionally omitted, feature-detected off), consistent with how it's already handled as absent on the macOS build per `design/feature-spec.md` §7.

---

## 5. The bigger gap: there's no backend

This wasn't asked about directly, but it's the thing that actually determines whether a web build could be *used*, not just demoed — worth flagging since the two questions above are both solvable-ish, but neither matters if there's nowhere to put the data.

The desktop app's entire storage model is **local files, no database, no server**: song/service/slide/theme data lives as plain JSON in a Dropbox-synced folder (`design/feature-spec.md` §7; `README.md`), read/written directly via `std::fs` in Rust (`src-tauri/src/domain/mod.rs`), specifically chosen *because* it avoids running any server or database (SQLite was explicitly ruled out due to concurrent-write corruption over Dropbox sync). The web demo's substitute is `localStorage` sample fixtures (`src/adapters/mock/collection.ts`) — fine for a click-through demo, useless for a real service where the data needs to persist, sync across the church's machines, and survive a browser cache clear.

Two realistic paths, both bigger than the Window Management/Bible API questions:

- **A real backend/server** — the church's library moves to an actual hosted service (even a small one) that the web build talks to over HTTP. This is the "normal" way to make a web app work, but it's a genuine architecture change: authentication, hosting, sync-conflict handling all move from "a Dropbox folder handles it for free" to "we now operate a service."
- **File System Access API** (`showDirectoryPicker()`, also Chromium-only) — the more interesting option, given how this app is actually built. See below.

### File System Access API, in more depth

This is probably the single most promising option in this whole document — more impactful than either of the two questions that prompted it — because it's the piece that would let a web build stop being "a demo with fake data" and become something a real service could actually run from.

**Mechanics**: `showDirectoryPicker()` (one click, once) lets the user point the web build at the *same* local `HopeWorshipStudio-Library/` folder the desktop app already reads and writes — the folder layout from `design/feature-spec.md` §7 (`songs/`, `services/`, `slides/`, `media/`, `manifest.json`) carries over completely unchanged. That returns a `FileSystemDirectoryHandle`, which can be persisted in IndexedDB so the picker doesn't reappear every launch; on reload, `queryPermission()` checks whether access is still granted, and `requestPermission()` (behind a user gesture — e.g. a "Resume access" button) re-asks if it's lapsed. Reads/writes work directly against real files, and `createWritable()` writes to a swap file that only commits atomically on `close()` — at least as safe as the current manual JSON write path in `src-tauri/src/domain/mod.rs`.

**Why it fits this app's model unusually well**: the storage design was already deliberately chosen to be "just files in a synced folder, no database" specifically to survive Dropbox's non-atomic sync (SQLite was explicitly ruled out for exactly this reason). That's precisely the shape this API is good at — a smaller conceptual leap here than for a typical web app, since there's no relational/query layer to somehow reinvent client-side.

**A concern that turns out to be a non-issue**: losing OS-level "watch this folder for changes" push notifications. It looks like a regression at first, but it isn't one — the existing conflict-detection code (`get_status()`, `src-tauri/src/domain/sync.rs:332-349`) is already **poll-based, not push-based**: there's no `notify`-style file-watcher crate anywhere in `Cargo.toml`, and the function is explicitly commented as intentionally passive ("a status check shouldn't have the side effect of touching manifest.json on every poll"). A web build re-reading on the same cadence would match current behavior exactly, not lose anything.

**Real limitations, stated plainly**:
- Chromium-only (Chrome/Edge/Opera/Brave) — same caveat as the Window Management API in §2; together they mean a serious web build would functionally require Chrome or Edge, not "any browser." For a church running one specific presentation computer, that's a smaller ask than it sounds — closer to how the desktop app is already Windows-only for its most distinctive features. **Unlike the Window Management API, this one is directly relevant on macOS** — confirmed supported on Chrome for macOS since Chrome 86, using the native macOS folder picker under the hood, no OS-specific gap. That matters because macOS is where this API would actually get used per the existing scoping in `design/feature-spec.md` §7 (the pastor's Mac, prep work only) — real local-file library access on the Mac, via Chrome, without needing a native macOS Tauri build at all.
- Permission persistence is better than old session-only behavior but isn't identical to a native app's unprompted access — worth prototyping the "resume access" UX rather than assuming zero friction, since exact behavior has shifted across browser versions.
- Each machine still independently picks its own local Dropbox folder path — true of the desktop app today too, not a new limitation.
- `dropbox_process_running()` (`sync.rs:319-326`) — a Windows-only `tasklist` heuristic for "is Dropbox actually running" — has no browser equivalent (no way to inspect other running processes, same sandboxing category as §4). Minor and cosmetic, not a blocker.
- Doesn't touch External App Hand-off or the local Remote Control HTTP server + mDNS (§4) — browsers can't bind a listening server socket or do LAN service discovery, so those stay out of reach regardless of this API.

**The big picture**: combined with the Window Management API (§2), File System Access would let a plain Chrome tab reconstruct nearly the entire architecture Tauri provides — real local file storage plus real second-screen fullscreen output — without shipping a native binary at all. What's left genuinely unclosable by any browser API: External App Hand-off (a sandboxing boundary, §4) and the local network Remote Control server (no listening sockets or LAN discovery from a web page).

### Sizing the storage-shaped remainder: the full `StudioAdapter` surface

Everything above treats "no backend" as one gap. It isn't — `src/adapters/types.ts`'s `StudioAdapter` interface has roughly 15 ports, and they don't all fail the same way in a browser:

- **Fundamentally impossible, in any browser, regardless of storage backend**: `RemotePort` (no listening HTTP server in the sandbox), `ExternalAppPort` (no launching/controlling other OS processes), `DisplayPort` and real second-window `LivePresentationPort.startPresenting`/`stopPresenting` (no native OS window the way Tauri's `WebviewWindow` gets one — the Window Management API in §2 is a *partial*, Chromium-only approximation of the last one, not an equivalent). All three are already `?`-optional on `StudioAdapter` and already absent from the mock/browser demo today, so this isn't new — it's confirming the ceiling is where §7 already assumed it was.
- **Storage-shaped, and realizable against IndexedDB or File System Access with no fundamental blocker**: `SongPort`, `ServicePort`, `SlideLibraryPort`, `MediaPort`, `ThemePort`, `PersonPort`, `AnnouncementPort`, `SettingsPort`, `ScripturePort`, `ExportPort`. This is the actual size of "add a real backend" — ten ports, not one vague gap.
- **Needs redesign, not a straight port**: `CanvaPort` (Tauri's OAuth flow uses a local loopback callback server; a real web deployment would need a different callback mechanism entirely) and `SyncPort` (its "sync client running"/Dropbox-conflict-file heuristics are meaningless against IndexedDB, and mean something different — permission/consistency state, not a third-party sync client — against File System Access).

### Two storage backends, not one

The File System Access discussion above frames it as *the* answer to "no backend." Worth widening that: a real web build could offer **two selectable storage backends**, not pick one —

- **IndexedDB** — works in every browser (not just Chromium), no folder-permission dance, no dependency on Dropbox/OneDrive/etc. being installed locally. The tradeoff: browser-local only — no cross-device sync, no interop with the desktop app's synced folder. The natural default/fallback.
- **File System Access** (above) — Chromium-only, but reads/writes the *same* real synced folder the desktop app uses, so a church running both gets genuine interop rather than two disconnected libraries.

The reason this is barely more design work than picking one: both backends only need to implement the same small storage abstraction — `list()`/`get(id)`/`save(item)`/`delete(id)` per collection, which is almost exactly `MockCollection`'s existing shape (`src/adapters/mock/collection.ts`) already. The *implementation* effort differs a lot between the two (IndexedDB is a self-contained browser API; File System Access needs the real folder-layout/manifest compatibility work described above), but the *shape* they'd both plug into is the same one either way — so designing for both from the start, even if only one is built first, isn't a wasted decision.

### What's reusable vs. what gets rewritten

Checked against the mock adapter (`src/adapters/mock/index.ts`) specifically, since it's the only existing browser-side implementation to learn from:

- **Reusable as-is**: `opensongParser.ts`'s `parseOpenSongXml` is fully pure (string in, parsed song out, no I/O, no storage coupling at all). The scripture-resolution utilities (`scriptureFixtures.ts`'s `loadKjv`/`availableTranslations`, `scriptureReference.ts`'s `parseReference`/`formatReference`/`getBookNames`/`isValidReference`) are equally storage-agnostic — a bundled JSON asset and pure string parsing, nothing localStorage-specific.
- **Reusable if the new backend's collections expose the same shape**: `recomputeSongUsage` (mirrors the Rust backend's `songs::recompute_usage`) only ever calls `list()`/`save()` on the two collections passed to it — never reaches into `MockCollection` internals — so it carries over unchanged against any backend exposing that same tiny async interface.
- **Gets rewritten per backend, not reused**: everything else in `mock/index.ts` — the CRUD wiring itself, staged-media/preview-URL maps, settings/diagnostics assembly — is written directly against `MockCollection`/localStorage/in-memory `Map`s. `MockCollection` also clones via a JSON round-trip rather than `structuredClone`, specifically to tolerate Vue-reactive-proxy inputs (see its own comments) — an incidental decision a new backend would need to make independently, not inherit.

### Real file-format compatibility (the File System Access path specifically)

For genuine interop with the desktop app — a church using both the desktop app *and* a web build against the same synced folder — the on-disk format constraint turns out to be smaller than it sounds. Confirmed via `src-tauri/src/models.rs` (`#[serde(rename_all = "camelCase")]` on every model struct) and `design/feature-spec.md`'s folder layout: the JSON already serializes in the exact camelCase shape the TS models already use (`Song`, `Service`, etc. — the same interfaces both the mock and Tauri adapters already share). So byte-compatible interop isn't a field-mapping problem — it's replicating the **folder layout** (`songs/<id>.json`, `services/<year>/<date>.json`, `slides/`, `themes/`, `media/`) and the **manifest behavior**: `src-tauri/src/domain/manifest.rs` rebuilds `manifest.json` from scratch on every save/delete rather than patching it, which a File System Access backend would need to match rather than trying to diff/patch entries itself.

One more thing this surfaces: per-machine data (display-role assignments, paired Remote Control devices, External App profiles) already lives *outside* the synced folder on desktop, in Tauri's local app-data dir — deliberately never synced. A browser build needs the equivalent split: something non-synced for browser-profile-local state. IndexedDB is a natural fit for that *regardless* of which backend ends up holding the actual library content, since it's already going to exist as a dependency either way.

### Adapter selection, cheaply

Today `getAdapter()` (`src/adapters/index.ts`) is a binary check: `window.__TAURI_INTERNALS__` truthy → Tauri adapter, else → mock/demo adapter. A real web-storage adapter needs a third branch, and there's already a free signal to key it off: `VITE_BASE_PATH` (`vite.config.ts`) is set *only* by the GitHub Pages demo's build step (`.github/workflows/release.yml`'s `deploy-demo` job) and never in a normal build — so "is this the public demo" is already answerable without inventing a new flag, just by checking whether that variable is set.

Widening `StudioAdapter['kind']` from `'tauri' | 'mock'` to include a third value has a real but bounded blast radius: it's checked at roughly 70 call sites across 23 files (mostly `adapter.kind === 'tauri'` gates hiding native-only UI — Setup Wizard's import cards, Media Library's file-path-dependent features, sync/external-app views). Because the existing checks are `=== 'tauri'` rather than `!== 'mock'`, a new third kind should fall through those gates correctly by construction (i.e., "not tauri" already correctly describes both mock and the new web adapter) — but that's a hypothesis to spot-check per call site, not something to assume blindly across all 70.

### Effort, sized honestly

A new adapter covering the ten storage-shaped ports above is, roughly, the size of the existing mock and Tauri adapters combined — `mock/index.ts` alone is already a substantial file, and a real backend adds genuine persistence logic mock doesn't need at all. If this is ever actually built, the sane starting point is a walking skeleton — the storage abstraction plus the two simplest ports (Settings, Songs), proven end-to-end — before mechanically repeating that same pattern across the remaining eight. That's a scoping note for whenever implementation is picked up, not a plan for right now.

---

## 6. Feature parity matrix

| Capability | Tauri desktop | Web demo (today) | Real web build (hypothetical) |
|---|---|---|---|
| Song/Slide/Service library editing | ✅ | ✅ (sample data only) | ✅ (needs §5 solved) |
| Local KJV scripture | ✅ | ✅ | ✅ — no work needed |
| ESV / api.bible lookup | ✅ | ❌ (not wired up; a shared demo key must never ship in the bundle) | 🟡 Likely — user-supplied key in `localStorage`, if CORS allows direct calls; a thin proxy otherwise |
| Second-monitor fullscreen audience output | ✅ (native window) | ❌ (simulated preview panel) | 🟡 Possible via Window Management API — Chrome/Edge only |
| Display "identify" (label monitors) | ✅ | ❌ | 🟡 `ScreenDetails.label` covers this |
| External App Hand-off (e.g. PowerPoint) | ✅ (Windows-only) | ❌ | ❌ — not possible in any browser, ever |
| Library storage (Dropbox-synced JSON) | ✅ | ❌ (`localStorage` fixtures) | 🟢 Strong candidate: File System Access API reads/writes the same real folder (Chrome/Edge only) — no backend needed |
| Local Remote Control (LAN, phone pairing) | ✅ (embedded HTTP server + mDNS) | ❌ | ❌ without a real server component |
| Native file/folder pickers, save-and-open | ✅ | 🟡 partial (`<input type=file>`, browser download, no folder picker) | same as demo, unless File System Access API is adopted |
| Order of Worship / report export (docx/pdf/xlsx) | ✅ | ✅ (pure JS libs, no native dependency) | ✅ — already parity |
| Clipboard | ✅ | ✅ (`navigator.clipboard`, already the same API) | ✅ — already parity |
| App version display, logs folder | ✅ | 🟡 / ❌ | minor, not architecturally interesting |
| Canva OAuth import | ✅ | ❌ | 🟡 possible, same key-exposure tradeoff as Bible APIs |

---

## 7. A proposed split: web build for prep, desktop for the live machine

This is the shape the idea should probably actually take, and it lines up well with everything above: **volunteers who set up services use a zero-install web build (File System Access API against the shared Dropbox-synced folder); the church's one presentation computer keeps running the full Tauri desktop app.** Nobody but that one machine needs the native install at all.

**Why the split falls out naturally from the research above**, not just from convenience:
- Every feature that's genuinely native-only — second-monitor fullscreen output, External App Hand-off, the local Remote Control HTTP server/mDNS — is also *already* scoped to "the live presentation machine only" in the existing design (`design/feature-spec.md` §7: Windows is "the only platform for live presentation"). The web build never needs to touch any of them; it was never going to run the live show anyway.
- Everything volunteers actually do — service creation, song/slide/media library editing, the scripture picker, volunteer roster, Order of Worship export — is already the exact list `design/feature-spec.md` §7 calls out as working "genuinely well in a browser demo." The UI side of this is close to done; it's specifically the storage layer that needs to change from the mock adapter's `localStorage` fixtures to real reads/writes against the shared folder.
- File System Access API (§5) is confirmed to work on both Windows and macOS Chrome — so this also incidentally solves the pastor's-Mac-prep-work case from the same spec section, via the browser, without a native macOS Tauri build.

**The real new cost this surfaces, that wasn't obvious before writing this down**: every Rust write path calls `manifest::rebuild(&root)` immediately afterward — `src-tauri/src/commands/{songs,services,slides,themes,people,media,announcements,canva,opensong}.rs` all do this — to keep `manifest.json` (the fast-startup index the desktop app relies on) consistent. A web build writing directly into the same folder via File System Access API would need an equivalent step in TypeScript, or the desktop app's manifest goes stale/wrong whenever a volunteer saves something from the browser. This isn't a config flag to flip — it's real domain logic (`src-tauri/src/domain/manifest.rs`) that would need a TypeScript equivalent, on top of the FSA read/write plumbing itself.

**Conflict safety gets more important, not less, under this design** — not a reason to avoid it, but a reason to not treat storage as "solved" once FSA read/write works. More concurrent editors (several volunteer browsers plus the live machine, all writing into one Dropbox-synced folder) increases exactly the risk `SyncPort`/`detect_conflicts()`/`detect_recovery_issues()` (`src-tauri/src/domain/sync.rs`) already exist to catch on the desktop side. That port is currently Tauri-only and entirely absent from the mock adapter (confirmed — no sync/conflict logic exists client-side today). Without porting at least conflict *detection* into the web build, a volunteer could silently produce a Dropbox "conflicted copy" file with no way to see or resolve it from the browser — worse than today, where at least the desktop app surfaces it.

**One phrase worth being precise about**: "zero install" means no WorshipStudio install, not literally nothing — each volunteer's machine still needs Dropbox's own desktop client running locally, sharing that same library folder, since File System Access API operates on real local files rather than Dropbox's cloud API directly. That's a much smaller ask (most people already have Dropbox installed if they're being handed a shared folder), just worth stating accurately.

**Not new, but inherited from the architecture either way**: Dropbox sync propagation delay between a volunteer's save and the live machine seeing it — already true today of any multi-desktop-install setup, not introduced by this proposal.

Net read: of everything in this document, this is the version of "a web build" that's actually well-scoped — it doesn't attempt anything native-only, it uses the one browser capability (File System Access) that's genuinely cross-platform and fits the app's existing file-based model almost exactly, and it leaves the one machine that needs full native capability as the only thing that has to stay Tauri.

---

## 8. If this were ever pursued — rough effort ordering

Not a plan, just a sanity check on relative size:

1. **Smallest**: local KJV in a web build — already done, zero work.
2. **Small**: Bible network APIs for a *private* (non-public-demo) web deployment — proxy or client-side key, contained change.
3. **Medium, but genuinely interesting**: Window Management API prototype for second-monitor fullscreen output — self-contained, testable in isolation, doesn't require the storage question to be solved first. Lower priority than #4 given live presentation is Windows-desktop-only regardless (§7).
4. **Medium-large, highest payoff**: File System Access API as a Dropbox-folder-compatible storage layer for a **prep-only web build** (§7) — the manifest-rebuild and conflict-detection logic need porting to TypeScript alongside the read/write plumbing itself, which is real work, but it avoids standing up a backend entirely and directly enables the volunteer-prep/live-machine split.
5. **Largest**: a real hosted backend — full architecture change, ongoing operational responsibility (hosting, auth, backups), only worth it if the goal shifts to removing the "Chrome/Edge only" constraint entirely, which isn't necessary for the split in §7.

Given the app's core live-presentation and External App Hand-off features are Windows-only regardless, the honest framing is: **a web build's realistic ceiling is prep work (library editing, service planning, scripture lookup) — which happens to be exactly what §7 proposes — not a full replacement for the desktop app during a live service.**
