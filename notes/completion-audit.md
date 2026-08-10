# Worship Studio Completion Audit

Last reviewed: August 1, 2026. 1.0 scope confirmed August 8, 2026: local Bible-file import, full automated help-video generation, and the web-based prep build (§7 of [web-feature-parity.md](web-feature-parity.md)) moved from "candidate post-1.0"/exploratory into required 1.0 scope. QR slide items turned out to already be fully implemented (`SlideQrElement`, live rendering, editor support), not a gap. Sheet-music/PDF mapping, built-in email delivery, and additional song import/export formats stay deferred post-1.0.

## Current assessment

The core application is close to a coherent, production-quality product. The primary screens—Services, content libraries, People, Roles, Templates, Themes, Reports, Planning, Settings, and Setup—have largely been brought to the same visual standard.

The next phase should emphasize reliability, consistent application states, and release hardening rather than another broad redesign or a large expansion of features.

## Highest priorities before production use

### 1. Protect library data from interrupted or invalid writes

Previously, JSON files were written directly to their destination, so an interrupted write, power loss, filesystem problem, or sync interruption could leave an incomplete file that was then silently skipped during loading.

Status: completed August 1, 2026.

- JSON is serialized before any existing file is touched, written to a unique temporary file in the destination directory, flushed to disk, and atomically moved into place.
- Every replacement preserves the previous valid version as an adjacent `.backup` file. A corrupt current file never replaces a known-good backup.
- Domain reads now distinguish missing files from malformed or unreadable files and return a path-specific error instead of silently omitting the record.
- **Library Health** scans the active library against the expected model for each file type, identifies whether a verified backup exists, and offers **Restore Backup**.
- When no valid backup exists, **Move Aside** preserves the damaged bytes beside the original while removing them from the active `.json` set.
- Recovery commands are restricted to JSON files inside the active library.
- Machine settings automatically restore a valid local backup when possible and never overwrite unrecoverable damaged settings with defaults.
- Canva authorization and other application-owned JSON files use the same atomic persistence helper.
- Moving a service between year folders commits the new file before removing the old copy.
- Focused tests cover backup preservation, serialization failure, invalid JSON reporting, restoration, quarantine, and path-boundary enforcement.

Relevant implementation: `src-tauri/src/domain/mod.rs` and `src-tauri/src/paths.rs`.

### 2. Establish standard loading and error states

Status: completed August 1, 2026.

The shared `useAsyncStoreState` convention now gives adapter-backed stores distinct initial-loading, background-refresh, retryable load-error, and retained mutation-error state. Core library pages use shared loading and empty-state components; Services, Songs, Presentations, Media, People, Themes, Templates, Roles, and Settings expose retry or save-failure feedback instead of failing blank or only logging to the console. Direct editors also distinguish loading from a missing item and preserve dirty content after a failed save.

Recommended shared states:

- Initial loading state or skeleton
- Empty library state
- Filtered-empty state
- Recoverable loading failure with Retry
- Save failure with an actionable message
- Offline/API failure where applicable
- Missing or malformed library item state
- Background refresh state that does not replace existing content with a spinner

These should be implemented through shared components and common store conventions rather than independently in every view.

### 3. Finish the focused credential review

Status: completed August 1, 2026.

The credential boundary is now deliberate rather than treating every credential alike:

- The Canva client ID and secret define the church's private integration. They are stored in the synced church library so its Worship Studio computers share one integration.
- Canva OAuth access and refresh tokens identify a particular computer's authorized Canva account. They remain local in `canva-auth.json` and never sync through the library.
- Existing machine-local Canva integration credentials migrate only when the shared church integration is entirely empty; shared values are never overwritten by an older computer.
- Bible API keys remain machine-local plaintext configuration. Given the private computers, limited Dropbox exposure, and replaceable keys, this is an accepted current tradeoff rather than a blocker.
- Remote-control pairing records and tokens remain machine-local.

Review findings and safeguards:

- Installed local credentials inherit the operating system user's application-data protections. Portable storage cannot promise equivalent filesystem permissions, so the documentation explicitly treats possession of the drive as access to its local authorization.
- Current logs contain operational paths, ports, and error summaries but do not serialize settings, OAuth requests, authorization headers, or pairing tokens. The planned diagnostics feature must remain allowlist-based and must never include credential-bearing files.
- Remote pairing cookies are `HttpOnly` and `SameSite=Lax`. Re-pairing rotates the device bearer token, invalidating old cookies, QR codes, and manual pairing links; revocation removes it entirely.
- The Canva loopback callback binds only to `127.0.0.1`, uses random OAuth state plus PKCE, and never exposes the authorization code or tokens to the frontend.
- An OS credential store remains unnecessary under the accepted trusted-church-computer/private-library threat model. Revisit that decision if the distribution or threat model expands.
- Canva rotation and reconnection procedures are documented, including the additional physical-security implications of portable storage.

Relevant implementation: `src-tauri/src/models.rs`, `src-tauri/src/commands/settings.rs`, and `src-tauri/src/commands/canva.rs`. See `notes/canva-setup.md` for the operational model.

### 4. Reconcile the email workflow

Status: completed August 1, 2026.

Assignments now uses an honest mail-client handoff rather than a fake delivery adapter:

- **Share Assignments** prepares one editable complete-roster message for everyone serving.
- Recipients are deduplicated and placed together in the To field; assigned people without an email address are identified before the draft is opened.
- **Open in Email App** supplies To recipients, subject, and body to the computer's configured mail handler.
- **Copy Message** copies all draft details as a reliable fallback for webmail or computers without a configured mail application.
- The UI states clearly that Worship Studio prepares the draft and the user's email application performs delivery.
- The no-op `EmailPort` and misleading **Send** action were removed.

Reports already provides **Copy Bulletin**, including rich HTML with a plain-text fallback. Word and PDF exports can be opened immediately and attached manually; `mailto:` cannot reliably add attachments.

Direct SMTP or provider delivery is explicitly deferred until after 1.0. Only add **Send** if a real transport, authentication, delivery failures, and credential handling are implemented together.

### 5. Add a pre-service readiness check

Status: completed August 1, 2026.

A single readiness check would provide more practical Sunday-morning reliability than most new feature work.

The service workspace now evaluates readiness continuously, shows a compact status beside **Start Presenting**, and provides a details dialog that separates blockers from warnings. Blockers prevent presentation and link directly to the affected service item, assignments page, or display picker. The check validates referenced content, media files, scripture resolution, external-app paths, countdowns, the audience display, and roster concerns. External applications are verified without launching them.

Suggested checks:

- Unfilled service-template placeholders
- Missing or unavailable local media
- Unresolved scripture passages
- Missing external applications, executables, or per-service files
- No connected/configured audience display
- Empty song arrangements or missing song blocks
- Missing referenced songs, slides, media, themes, or people
- Invalid countdown targets
- Optionally, unassigned critical roles
- Optionally, assignment conflicts and unavailable people

Suggested interaction:

- Show a compact status near **Start Presenting**.
- Distinguish blockers from warnings.
- Allow the operator to open the affected item directly.
- Re-run automatically after relevant edits or display changes.
- Present a clear green **Ready to Present** state when no blockers remain.

## Design-standard audit

### Library Health and Sync Conflicts

Status: completed August 1, 2026.

The former Sync Conflicts screen is now a Library Health workflow with separate damaged-file recovery and synced-version review sections. It uses the established page hierarchy and shared loading/error/empty states, provides responsive field comparisons with clear device identity and discard explanations, shows resolution progress, and offers a return action when review is complete.

Resolving or recovering an item now refreshes the corresponding in-memory library store so editors, reports, and presentation do not retain the discarded version. The service-readiness check also surfaces warnings for conflicts involving the current service or its referenced songs, slides, media, themes, or people, while unrelated conflicts remain global Library Health concerns.

### Editor not-found states

Song, Slide, Person, Service, and Assignment pages still have plain-text not-found fallbacks. Themes and Templates already have more deliberate states.

Create one shared not-found pattern with:

- Contextual icon
- Clear title and explanation
- Back-to-library or Back-to-Services action
- Optional Reload action
- Consistent spacing and card treatment

### Loading, empty, and filtered-empty states

Libraries currently implement similar states with duplicated view-specific CSS. Extract a shared state component that supports icon, title, description, primary action, and secondary action.

### Dialog consistency

Review dialogs for consistent:

- Header icon and title treatment
- Supporting description
- Close affordance
- Primary action placement and wording
- Cancel/secondary action style
- Validation behavior
- Fixed versus content-driven sizing
- Small-screen behavior
- Focus placement and keyboard dismissal

The Assignments email dialog is one visible example of the older generic style.

### Shared page headers

Library and editor headers are visually similar but independently implemented. Shared `LibraryPageHeader` and `EditorPageHeader` components would reduce drift while retaining slots for page-specific actions, metadata, and status.

### Large view decomposition

These files have become difficult to maintain safely:

- `src/views/ServiceWorkspaceView.vue` — roughly 4,000 lines
- `src/views/SettingsView.vue` — roughly 2,700 lines

Decompose them by user-facing section, not merely by code type. Good candidates include:

- Service details dialog
- Audience-display chooser
- Add-to-Service dialog and individual content panels
- Service order list
- Selected-item editor panels
- Live preview/transport area
- Each Settings section
- External-app profile editor
- Remote-control settings
- Bible translation settings

This is partly maintainability work, but it also makes visual consistency and targeted testing much easier.

### Intentionally minimal windows

The audience Presentation window and Identify Display window are special-purpose surfaces. They do not need the normal application page chrome or library/editor design language.

## Features to complete or explicitly defer

Each item should be assigned to a named milestone such as **0.5 polish**, **before 1.0**, or **post-1.0**.

### Audio service items

The data model recognizes audio, but live rendering remains a placeholder. A complete implementation needs file selection, playback, pause/seek/stop behavior, live-transition semantics, missing-file handling, remote behavior, and operator status.

### Sheet music / PDF region mapping

Status: post-1.0 by explicit decision (confirmed August 8, 2026). Not implemented and already described in the feature specification as speculative. Only reconsider if real users identify it as necessary.

### Additional song import and export

Status: post-1.0 by explicit decision (confirmed August 8, 2026). Still absent:

- ChordPro structure import
- Plain-text paste and parse
- OpenSong XML export

OpenSong import covers the immediate migration need, so these stay deferred and can be prioritized from actual usage rather than feature parity.

### Local Bible-file import

Status: in scope for 1.0 (decided August 8, 2026).

KJV and API-backed translations are supported, but the general local Bible import workflow is not complete. Decide whether churches need OpenSong Bible files or another documented format, then implement it before 1.0.

### Email delivery

Status: post-1.0 by explicit decision (confirmed August 8, 2026). Built-in delivery is deferred until after 1.0, if it ever happens. Worship Studio deliberately remains responsible for message and document generation, then delegates account access and delivery to the user's installed mail application. Revisit SMTP or a cloud provider only if early adopters demonstrate that opening a prepared draft is insufficient.

### Replace undo toasts with real undo/redo history

Status: completed August 1, 2026.

The former expiring callback-toast stack has been replaced with document-scoped snapshot history. The app bar now shows Undo and Redo beside Save for editors that register history, including services, assignments, songs, presentations, people, themes, service templates, roles, and settings. Continuous edits in one field are grouped, structural edits remain separate, saved revisions drive dirty state, and changing records clears the active history. The controls expose their action and shortcut in visible tooltips and support `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`, and the corresponding macOS shortcuts.

Persisted library deletion is intentionally outside editor history: Songs, Presentations, Media, and Services delete immediately after explicit confirmation rather than hiding the item while a toast timer decides whether to touch disk.

Replace it with a conventional editing model:

- Show persistent **Undo** and **Redo** buttons beside the standard Save control whenever the active editor provides history.
- Support `Ctrl+Z`, `Ctrl+Y`, and `Ctrl+Shift+Z`, with the corresponding macOS shortcuts where applicable.
- Scope history to the active document or settings editor and clear it when switching records.
- Group continuous typing into meaningful history entries while keeping add, remove, reorder, and property changes as distinct steps.
- Integrate the current history position with dirty-state and saved-state tracking.
- Disable the buttons when their action is unavailable and provide visible tooltips that include the shortcut and, where practical, the action label.
- Stop using expiring undo toasts as the primary undo mechanism. Ordinary success notifications may remain ordinary snackbars.
- Handle persisted library deletion through an explicit confirmation or a deliberate future Trash workflow rather than a delayed toast callback.

The shared history implementation lives in `src/stores/history.ts` and `src/composables/useDocumentHistory.ts`.

### Automatic updates

Status: deprioritized (decided August 8, 2026) — day-to-day use is mostly running in dev mode rather than the distributed installer, so the lack of an updater isn't currently felt. Revisit priority as real distribution to church machines picks up.

The release workflow creates versioned artifacts, but the application does not check for, download, or install updates. Add a Tauri updater before distributing broadly, or document a clear manual update process and expose the Releases page prominently.

### Help and documentation generation

Status: in scope for 1.0, including full automated help-video generation (decided August 8, 2026).

The application has source, issue, and release links in About, but does not yet have an operator guide, keyboard-shortcut reference, troubleshooting flow, or generated help videos.

### Web-based prep build

Status: in scope for 1.0 (decided August 8, 2026). See [web-feature-parity.md](web-feature-parity.md) §7 for the full research this decision is based on.

A zero-install web build lets volunteers do service/library prep — song, slide, service, and media library editing; scripture lookup; volunteer roster — from a browser, using the File System Access API to read and write the same Dropbox-synced folder the desktop app uses, rather than the demo's `localStorage` fixtures.

**Implemented August 8, 2026**: the sync/conflict-detection logic (`src-tauri/src/domain/sync.rs`) is ported to TypeScript — `src/adapters/web/fsaStorage.ts` (generic File System Access read/write/list/remove helpers, the walking-skeleton "storage abstraction" piece) and `src/adapters/web/sync.ts` (`detectConflicts`, `resolveConflict`, `detectRecoveryIssues`, `recoverFromBackup`, `quarantineDamagedFile` — a close translation of the Rust functions of the same shape, kept side-by-side comparable rather than reimagined). Two deliberate, documented gaps versus the Rust version: it assumes `.backup` files already exist (from the desktop app's writes) rather than giving the web build's own writes backup-on-write behavior yet — that belongs with the actual Songs/Settings storage-port work, not conflict detection; and `validateLibraryJson` only checks for a present `id` field per kind rather than fully deserializing against each model's real shape, since no runtime schema-validation library is in use — still catches the real failure mode (interrupted writes leaving truncated JSON), just not "valid JSON, wrong shape."

**Walking skeleton implemented August 8, 2026** (same day, second pass): `StudioAdapter['kind']` widened to `'tauri' | 'mock' | 'web'` and `DiagnosticSummary.installationMode` widened to include `'web'`. `src/adapters/web/settings.ts` and `src/adapters/web/songs.ts` are real, tested FSA-backed ports — `LibrarySettings` at `library-settings.json` in the picked folder (synced, matching the desktop build), `MachineSettings` in the browser's own `localStorage` (never synced, matching the desktop build's per-machine app-data file being deliberately outside the synced folder). Everything else in `createWebAdapter()` started as an honest `throw`-on-call stub rather than a silent fake.

**All ten storage-shaped ports completed August 8, 2026** (same day, third pass — see the "Sizing the storage-shaped remainder" section of [web-feature-parity.md](web-feature-parity.md) §5 for the original list): `src/adapters/web/collection.ts` extracted the shared list/get/save/delete/stamp pattern once real duplication showed up across Songs, Themes, People, and Announcements. `src/adapters/web/themes.ts`, `people.ts`, `announcements.ts` are thin wrappers over it. `src/adapters/web/slides.ts` adds real QR generation via the new `qrcode` npm dependency (MIT-licensed, ~well-established) — using its SVG output rather than its canvas-based PNG path, since canvas isn't available in the vitest/jsdom test environment without another native dependency, and an `<img>` consumer can't tell PNG from SVG either way. `src/adapters/web/services.ts` handles the year-subfolder layout directly (doesn't fit the shared collection helper) and ports `recomputeSongUsage` from the mock adapter's own version of the same Rust logic; `importOpenSongSets` returns `undefined` (the already-documented "no browser equivalent" contract every adapter uses) and `migrateLegacySermonFields` is a genuine no-op, since any library with pre-migration data was necessarily created by the desktop app, which already runs that backfill on every launch. `src/adapters/web/media.ts` is the largest: real file bytes read/write to `media/`, `media-items/<id>.json` metadata, content hashing via Web Crypto's `SHA-256` (matching Rust's own "no hashing crate for something this low-stakes" reasoning, just applied to what's actually built into the browser instead of `DefaultHasher`), filename-collision dedup, and `importStockBackgrounds()` doing a real `fetch()` of the bundled `public/stock-backgrounds/` assets rather than faking a record the way the mock adapter has to. One documented simplification: `'local'` (never-synced, machine-only) media has no distinct destination yet — it lands in the same picked folder as `'synced'` media, since a genuinely separate local-only folder would need a second `showDirectoryPicker()` grant; noted in the code rather than silently claiming location fidelity that isn't there.

Covered by 47 vitest cases across the adapter (11 sync, 5 Settings, 5 Songs, 4 for the shared collection helper, 3 for Themes/People/Announcements, 2 Slides, 9 Services, 7 Media) against the hand-rolled in-memory File System Access fake, extended to store real bytes (not just text) once Media needed it. `type-check`, `lint`, `prettier --check`, the full `test:unit` suite (370 passed), and a full production `build` are all clean — the adapter object type-checks against the complete `StudioAdapter` interface with every required port now genuinely implemented, not stubbed.

**`getAdapter()` wiring completed August 8, 2026** (same day, fifth pass): `src/BootGate.vue` is now the actual root component `main.ts` mounts (`App.vue` itself is unchanged). The reason a new root component was needed rather than an early-return inside `App.vue`: `App.vue` already calls `getAdapter()` synchronously at `<script setup>` module scope, before its own `onMounted` even runs, so the adapter has to be fully resolved *before* `App.vue` is instantiated at all — not something a v-if inside its template could gate. `BootGate.vue` resolves the adapter first (instant, no UI, for Tauri and the public GitHub Pages demo build — `isPublicDemoBuild()` checks `import.meta.env.BASE_URL !== '/'`, the only thing `VITE_BASE_PATH` ever sets it to) and only renders `<App />` once resolution finishes. For the real (non-demo) web case it does the full flow: check `src/adapters/web/handlePersistence.ts`'s IndexedDB-stored handle, `queryPermission()` it, resolve silently if already granted, prompt for a `requestPermission()` click if not (a "Resume Access" screen), or show the initial "Open Your Library Folder" / "Try the Demo" chooser if no handle is stored yet — matching the exact flow validated in the earlier File System Access spike. `adapters/index.ts` gained `setAdapterInstance()`/`isTauri()`/`isPublicDemoBuild()`; `getAdapter()` itself is otherwise unchanged and still resolves Tauri/mock on its own if ever called before `BootGate` sets an instance.

One real gap surfaced during implementation: TS's bundled DOM lib doesn't include `showDirectoryPicker` or the `queryPermission`/`requestPermission` handle methods (still-experimental "Project Fugu" APIs) — added the community `@types/wicg-file-system-access` package (MIT, declaration-merges against lib.dom's existing `FileSystemHandle`/`FileSystemDirectoryHandle`) and wired it into `tsconfig.app.json`'s `types` array. That alone wasn't enough: `tsconfig.vitest.json` *overrides* (doesn't merge with) the inherited `types` array down to `["node"]` only, which silently dropped the new types for every `.vue`/`.ts` file vitest's project reference touches (TS config `types` arrays replace on override, not merge) — fixed by listing both there too. Worth remembering for the next global ambient-types addition to this project.

Verified with a real automated smoke test (Playwright/headless Chromium against the Vite dev server, not just unit tests): the chooser screen renders correctly with both buttons and matches the app's branding, and clicking "Try the Demo" loads the full real app (Services dashboard, sample data) with zero console errors. `cargo`/frontend validation all still clean; production `build` succeeds (main bundle grew ~19 KB now that the web adapter and `qrcode` are actually reachable code, not dead-code-eliminated).

**Confirmed by real human testing, August 8, 2026**: picking a real folder via "Open Your Library Folder" and using the app against it works. This is the first part of this whole effort verified against a real browser and a real folder rather than the fake FSA test double or an automated headless run.

**Two real bugs fixed the same day, surfaced by that manual testing**:

- **Background/media images weren't loading anywhere in the web build** (and, it turns out, never worked in the mock/browser-demo build either — this predates the web adapter, just never got exercised with real content before). `ServiceWorkspaceView.vue`, `ThemeLibraryView.vue`, and `ThemeEditorView.vue` all resolved media/background URLs through exactly one path — `media.getFilePath` (Tauri-only, optional) — with an early return and no fallback when it's unavailable. Every adapter (including mock) implements `media.getPreviewUrl` unconditionally, so all three now prefer `getFilePath` when present (unchanged Tauri behavior) and fall back to `getPreviewUrl` otherwise.
- **No favicon.** `index.html` had no `<link rel="icon">` at all. Reused `src-tauri/icons/icon.ico` (the existing desktop app icon, copied to `public/favicon.ico`) rather than generating a new asset.

**Real audience-window presenting implemented August 8, 2026** (same day, sixth pass), after confirming `live` was still the documented no-op placeholder. `src/adapters/web/live.ts` (`LivePresentationPort`) opens a plain `window.open()` audience window and drives it over a `BroadcastChannel` (`src/adapters/web/audienceChannel.ts` — a `'ready'`/`'content'` handshake, the same reason the Tauri build's `presentation:ready` event exists: a message sent before the new window's listener attaches is simply lost). `src/views/WebAudienceView.vue` is the audience window's content — detected in `main.ts` via a `?presentation=1` query param (mirroring how the Tauri build detects its `presentation`-labeled native window, just via URL instead of a window label) and mounted directly, bypassing `BootGate`/adapter resolution entirely since this window only ever needs the broadcast stream. It renders through the exact same `SlideContentRenderer.vue`/`SlideSceneRenderer.vue` every other live-content consumer already uses (the Tauri presentation window, the Remote Control phone mirror) — confirmed via research that these components have zero Tauri dependencies before building on them, per direct user steer to reuse the existing control rather than reimplement rendering.

Fullscreen, including **per-monitor selection** (added same day after initial manual confirmation, per request): windowed by default (required — some operators have no second monitor at all), with a two-tier "Choose Display…" control using `getScreenDetails()`/`requestFullscreen({screen})` when the Window Management API is available, falling back to a plain in-place `requestFullscreen()` (no screen targeting) otherwise. Two-tier because both `getScreenDetails()`'s permission prompt and `requestFullscreen({screen})` need their own genuine click inside the audience window itself — confirmed in the original August 2026 spike and unavoidable, not a design choice. Needed a second types package (`@types/webscreens-window-placement`, alongside `wicg-file-system-access`) added to both `tsconfig.app.json` and `tsconfig.vitest.json`'s `types` arrays for the same reason as before.

**Confirmed by real human testing, August 8, 2026**: the monitor-picker enhancement — "Choose Display…" correctly lists real monitors and fullscreens onto the specific one chosen. Closes out the last unverified piece of the presenting work.

**Canva stays Tauri-only — decided August 8, 2026, backed by real research, not assumption.** Checked Canva's own Connect API docs directly rather than guessing: PKCE does not solve this. PKCE only protects the authorization step; the token-exchange step requires HTTP Basic Auth with the client secret, and Canva's own docs state plainly that "requests that require authenticating with your client ID and client secret can't be made from a web-browser client — they'll be blocked by Canva's CORS policy." That's a hard block from Canva's server, not a best-practice recommendation — no way to store or hide the secret client-side gets around it. A working web build integration would need a real backend/proxy server just for the token-exchange step, which undercuts the web build's entire "zero-install, no server to run" premise for a content-import convenience feature. Decided not worth it: Canva stays desktop-only, and churches needing Canva content from the web build use the manual workaround that already exists regardless — export from Canva directly, then import the file as ordinary media through the web build's normal media import flow (`pickFilesToImport`/`commitImport`, already fully working). Revisit only if a church actually asks for direct in-browser Canva import.

**The four gaps noted above were closed August 9, 2026** (same effort, next pass):

- **Backup-on-write**: `fsaStorage.ts`'s `writeJsonFile()` now mirrors `write_json_file` (`src-tauri/src/domain/mod.rs`) exactly — serializes the new value first (a serialization failure touches nothing on disk), then, only if a previous version exists and still parses as valid JSON, writes it to `<path>.backup` before overwriting the real file. An already-corrupt existing file is left alone rather than clobbering a known-good backup with garbage. `sync.ts`'s `recoverFromBackup`/`quarantineDamagedFile` needed no changes — they already read whatever `.backup` exists; this just means the web build's own writes now produce one, closing the gap called out in the August 8 entry above. 4 new vitest cases (`fsaStorage.spec.ts`).
- **Bible API key wiring**: `src/adapters/web/scripture.ts` is a close TypeScript port of `src-tauri/src/domain/scripture.rs`'s `resolve_esv`, `resolve_api_bible`, `list_api_bible_catalog`, the 66-entry OSIS book-code table, and `parse_bracketed_verses` — same URLs, header names (`Authorization: Token <key>` for ESV, `api-key` for api.bible), query params, and passage-id format (`BOOK.C.V` or `BOOK.C.V-BOOK.C.V` for a range), verified line-by-line against the Rust source rather than trusted from a paraphrase. Wired into `createWebAdapter()`'s `scripture` port in `adapters/web/index.ts`: `resolve()` now dispatches on translation code exactly like the Rust `resolve_scripture` command does (ESV → `esvApiKey`, any other non-KJV code → a library-configured `apiBibleTranslations` entry + `apiBibleKey`, else local KJV); `listTranslations()`/`listApiBibleCatalog()` are real now too. `BibleTranslationsSection.vue` needed zero changes — it was already written against the adapter-agnostic `ScripturePort` interface. 11 new vitest cases (`scripture.spec.ts`, fetch mocked).
- **`pickLibraryFolder()` / in-app folder switch**: `adapters/web/settings.ts`'s `pickLibraryFolder()` now really opens `showDirectoryPicker()`, persists the new handle via `handlePersistence.ts`'s `storeLibraryHandle()` (overwriting the one used to construct the *current* session's adapter, which keeps working until reload), and returns the folder's own `.name` as the closest browser equivalent of a path string. Deliberately reuses the existing machinery rather than building new hot-swap plumbing: `SettingsView.vue` already prompts "the library folder has changed — reload now?" by comparing the returned string against the last-saved value, and `window.location.reload()` sends the page back through `BootGate.vue`, which re-resolves from whatever `handlePersistence.ts` now has stored — no live Pinia-store hot-swap needed. `SetupWizardView.vue`'s "Shared library folder" card, previously gated to `isDesktop` only (with a "browser demo" caption that predated the real web adapter), now also enables Choose/Change Folder for `kind === 'web'`; "Portable" stays desktop-only since its relative-path convention (`./Library`) has no browser meaning. 4 new vitest cases (`settings.spec.ts`).
- **Real second local-only media folder**: `handlePersistence.ts` gained a second IndexedDB key (`local-media-dir`, alongside the existing `library-dir`) with its own store/load/clear functions. `media.ts` now routes by `item.location`: `'synced'` items still live under the picked library folder's `media/` subfolder; `'local'` items live flat in a separately granted folder (mirroring Rust's `local_media_root.join(filename)`, no subfolder), granted lazily — `commitImport` is the only call site guaranteed to run inside the "Import" button's click, so it's the only one that prompts `showDirectoryPicker()`; `getPreviewUrl`/`delete` only use an already-granted handle and quietly no-op/return `undefined` otherwise, since a synced `media-items/*.json` record with `location: 'local'` can legitimately exist on a machine that never granted (or was never offered) that particular device's local folder — that's inherent to "local," not a bug. 4 new vitest cases (`media.spec.ts`).

Full validation after all four: `type-check`, `lint`, `prettier --write`, the full `test:unit` suite (393 passed), a production `build`, and `cargo check` all clean.

**QR generation consolidated, August 8, 2026** (same day, fourth pass): adding the `qrcode` npm dependency for the web adapter's Slide QR element surfaced that the Tauri adapter's `generateQrCode` didn't need its Rust round-trip at all — QR generation is pure and client-side, unlike Remote Control's pairing QR (native-only, embedded HTTP server, no browser equivalent), which is the only thing `remote_server::qr_data_url` actually needs to stay in Rust for. Moved to a single shared `src/utils/qrCode.ts` used identically by the Tauri, mock, and web adapters; removed the now-unused `generate_qr_code` Tauri command and its `lib.rs` registration. Side effect worth noting: the mock/browser-demo build's Slide QR element went from a hardcoded empty string ("real QR rendering is Rust-side only") to a genuinely real QR code, since the shared implementation has no reason to fake it there anymore. `cargo build`/`fmt --check`/`test` (167 passed) and the frontend `type-check`/`lint`/`test:unit` (370 passed) plus a production `build` are all clean.

**Implemented August 8, 2026**: `manifest.json` eliminated as a persisted file rather than trying to make it sync-safe. It was originally documented (`notes/architecture-plan.md:90`) as an "index for fast startup, no full-folder scan," but that optimization was never actually wired up — the app still does full per-collection scans at startup for the UI regardless — and its only real consumer turned out to be `get_status()`'s single `last_library_change_at` timestamp, read just twice a session (app launch, and the manual "Refresh" button in Library/Sync settings; not polled, and not used by Library Health's actual conflict/recovery scanning or diagnostics counts). `domain::manifest::rebuild()` (renamed `compute()`) now only lists every collection and builds entries in memory — its `write_json_file()` call is gone, and `get_status()` calls it on demand instead of reading a file. Net effect: no file means no Dropbox sync, no conflicts, no per-device naming or stale-file question to solve; it's out of Library Health's corruption/backup/restore scanning (`domain/sync.rs`'s `"manifest.json"` dispatch branch removed); all ~16 write-path `manifest::rebuild()` calls (`commands/{songs,services,slides,media,themes,people,announcements,canva,opensong,stock_content,sync}.rs`) are gone since nothing persists after a save; and the web build's scope shrinks — there's no manifest storage format left to port to TypeScript, just the equivalent in-memory scan for the browser's own status display.

One real bug surfaced and fixed during implementation: `songs::list()` and its siblings deliberately hard-fail the whole listing if any single item fails to parse (by design, for the library-editing views — completion-audit item 1's "malformed vs missing" distinction). `manifest::compute()` reuses those same list calls, so a naive `get_status()` would abort entirely — losing `folder_readable`, `conflict_count`, and `recovery_count` along with it — the moment any one file was corrupted or sitting as an unresolved Dropbox conflict. That's exactly the situation Library Health exists to help diagnose, so failing the whole status check in response would have been a real regression from the old always-available-if-stale `manifest.json` read. Fixed by treating `manifest::compute()`'s result as best-effort inside `get_status()` (`.unwrap_or_default()` — a degraded/missing `last_library_change_at` rather than a hard failure); `detect_conflicts`/`detect_recovery_issues` were never affected, since they scan the filesystem directly rather than going through `manifest::compute()`. Verified: `cargo fmt --check`, `cargo build`, and the full `cargo test` suite (167 passed) all clean.

Also included: user-supplied ESV/api.bible keys stored in the browser's own `localStorage` — confirmed August 8, 2026 via an empirical CORS check (`curl` with an `Origin` header) against both providers; both permit direct cross-origin calls with their real auth headers, no proxy needed (see [web-feature-parity.md](web-feature-parity.md) §3) — and the Window Management API for monitor-identify labeling and second-monitor fullscreen audience output.

Decided August 8, 2026: the audience view must not require a second monitor. The operator can decline to pick a second screen, or deliberately pick the same screen for both operator and audience; either way the web build opens the audience view as an ordinary windowed (non-fullscreen) view over the same `BroadcastChannel` content path, skipping `getScreenDetails()`/`requestFullscreen({ screen })` entirely rather than forcing multi-monitor hardware to even try it out.

Confirmed via a real two-monitor spike, August 8, 2026 (see [web-feature-parity.md](web-feature-parity.md) §2): `requestFullscreen({screen})` cannot be triggered from the operator's own click — it has to be a genuine click inside the newly opened audience window itself, or Chrome throws `Permissions check failed`. So "start presenting" onto a second screen is at minimum a two-click flow: the operator's click opens the audience window, then a second click inside that window (an obvious on-screen prompt, not hidden) is what actually goes fullscreen. Design the UX around that rather than assuming a single click can do both.

The Window Management API side of this item is fully de-risked as of August 8, 2026 — a working spike against real two-monitor hardware validated screen enumeration, correctly anchored fullscreen, per-window `BroadcastChannel` content delivery, and the windowed fallback, all end-to-end. The Bible-API CORS question is also resolved (above).

Storage layer also spiked and confirmed, August 8, 2026 (see [web-feature-parity.md](web-feature-parity.md) §5): `showDirectoryPicker()` against a real library folder correctly listed the known subfolders and read/parsed a real song file; `createWritable()`/`close()` write, read-back, and delete all round-tripped cleanly; and — the biggest open risk — a `FileSystemDirectoryHandle` stored in IndexedDB came back `queryPermission() === "granted"` after a page reload with **no re-prompt at all**, better than the research doc's cautious expectation. All three of §5's core claims are now hardware-verified on Windows Chrome, not just docs-plausible. Not yet checked on macOS Chrome — worth a quick recheck there given the pastor's-Mac use case, but this is no longer an open technical unknown blocking the decision to build it; remaining work is implementation (the conflict-detection TS port, the ten storage-shaped adapter ports, manifest-format compatibility) rather than feasibility risk.

The live presentation machine stays on the Tauri desktop app. Second-monitor fullscreen audience output, External App Hand-off, and the local Remote Control HTTP server/mDNS are not implemented for the web build — they're sandboxing boundaries a browser cannot cross, not features that were deprioritized. A real hosted backend/server is explicitly out of scope; the File System Access API against the existing synced-folder model covers the committed scope without one.

### Tablet (PWA) cloud sync build

Status: in progress, August 9, 2026. Not yet in scope for 1.0 — tracked here as its own effort, distinct from the web build above.

Tablets (iPad/Android) can't do what the desktop or web builds do: no Tauri mobile build exists, and `showDirectoryPicker()` (the web build's whole storage story) isn't supported on any tablet browser at all. The design landed on a third `StudioAdapter` kind, `'tablet'`: an OPFS-backed local cache kept in sync with the church's existing library directly over a cloud provider's REST API (no desktop client, no hosted backend), rather than a real picked folder. A native Tauri mobile build was considered and rejected in favor of a PWA specifically because OPFS inside a wrapped native webview (WKWebView on iOS) has a confirmed 10MB-per-file cap that OPFS in a real browser engine doesn't.

**Phases 1–3 implemented August 9, 2026** (Dropbox only, initially): `src/adapters/tablet/` — `opfs.ts` (thin wrapper around `navigator.storage.getDirectory()`), `dirtyTrackingRoot.ts` (a Proxy-based wrapper over the OPFS root that fires on `write`/`remove`, letting every unmodified `web/*.ts` port work against it as-is — the same reuse strategy the web build itself used against a real picked folder), `syncStore.ts` (IndexedDB: cursor, dirty paths, remote revs, open conflicts), a PKCE OAuth flow, and a pull/push/conflict-routing sync engine. Key enabling fact, verified against Dropbox's own docs rather than assumed: Dropbox supports full PKCE for public clients with no client secret at all, for both token exchange and refresh — unlike Canva (blocked by CORS on the secret-bearing token exchange, which is why Canva stays desktop-only, see above). Conflict artifacts are written in the exact filename format `web/sync.ts`'s existing `CONFLICT_PATTERN` regex already scans for, so `SyncConflictsView.vue` needed zero changes to pick them up. 50 vitest cases against a fake `FileSystemDirectoryHandle` and mocked `fetch`.

**Generalized to a provider-agnostic sync engine, then OneDrive added, August 9, 2026**: mid-build, three questions came up — should desktop/web get the same cloud-API option (not just tablets)? Is the connect flow too technical for a volunteer? Should OneDrive/Google Drive be supported too? Investigated for real: desktop/web already could reach the connect flow (`BootGate.vue`'s chooser was never gated to tablets), the actual gap was no way back to it from Settings once a device picked folder-mode; OneDrive turned out to be viable the same no-backend way as Dropbox (confirmed against Microsoft's docs: the `spa` app-registration type needs no client secret for the full Authorization Code + PKCE flow, with real CORS support on the token endpoint) but with one real difference — a refresh token issued to an `spa` redirect is capped at a 24-hour lifetime no matter what, forcing a silent (`prompt=none`, hidden-iframe) or occasionally visible re-auth roughly daily; **Google Drive is not viable the same way and was deliberately dropped** — its only OAuth client type that accepts an HTTPS redirect URI ("Web application") requires a client secret on every token exchange and refresh, and PKCE does not remove that requirement, the same class of blocker that keeps Canva desktop-only.

`dropboxClient.ts`/`dropboxAuth.ts` moved to `src/adapters/tablet/providers/`, and `dropboxSync.ts` generalized into `cloudSync.ts` behind a new `CloudSyncProvider` interface (`providers/types.ts`) — the pull/push/backoff/conflict-materialization logic is unchanged, just decoupled from Dropbox specifics (pagination, cursor-reset recovery, lower-case-vs-display-case paths, which HTTP status means what). `providers/dropbox.ts` is the existing logic reshaped to the interface; `providers/onedrive.ts` (Microsoft Graph: delta-feed listing, eTag-based conditional writes via `If-Match`/`If-None-Match`, upload sessions chunked in multiples of 320 KiB for large files) and `providers/onedriveAuth.ts` (PKCE against the `spa` platform type; `getValidAccessToken()` attempts a silent hidden-iframe reauth once the 24h cap passes, falling back to a new `SyncStatus.needsReconnect` flag rather than failing silently forever) are new. 62 new vitest cases; `cloudSync.spec.ts` includes a provider-swap test proving the orchestration logic is identical regardless of which provider is injected.

`LibrarySettings`/`MachineSettings` (`src/models/settings.ts`, `src-tauri/src/models.rs`) gained `oneDriveIntegration: { clientId }` alongside the existing `dropboxIntegration`, and `MachineSettings`'s Dropbox-specific per-device fields were renamed provider-agnostic (`dropboxAppKey` → `tabletCloudClientId`, `dropboxLibraryFolderPath` → `tabletCloudLibraryFolderPath`, plus a new `tabletCloudProvider`) — safe since none of this had shipped yet.

**Setup simplified, same day**: `BootGate.vue`'s chooser now offers both providers directly, and gained `?connect=<provider>&key=...&path=...` handling (checked at the same priority as the OAuth-redirect check) that pre-fills and immediately starts the connect flow — paired with a new "Add Another Device" link/QR generator in the rebuilt `LibrarySyncSection.vue` (reusing `src/utils/qrCode.ts`, the same generator Remote Control pairing already uses; the app key/client ID isn't a secret, so it's safe in a plain link). This turns "type in a raw app key" from a per-device chore into a one-time-per-church task done only for the first device. `LibrarySyncSection.vue` was rebuilt to cover every adapter kind in one page: a "Library location" panel with a "Switch Provider or Folder" action that routes back through `BootGate`'s chooser for *any* kind (closing the previous dead end where picking one connection method left no way back to the others), and a "Cloud connection" panel (status, Sync Now, the max-cached-file-size field, Add Another Device, a `needsReconnect` prompt). "Data tools" (Load Sample Data, etc.) stayed gated off for `kind === 'tablet'` at this point — those act through the songs/services/media/... ports, still honest `notImplementedPort` stubs until Phase 4 below.

Full validation after each step: `type-check`, `lint`, the full `test:unit` suite (497 passed), a production `build`, and `cargo fmt --check`/`clippy -D warnings`/`test` (171 passed) all clean throughout.

**Confirmed by real human testing, August 9, 2026**: Dropbox connect → reconnect-on-reload → Settings' Cloud connection panel all verified against a real Dropbox account and a real Entra app registration (Microsoft 365 subscriptions include a free Entra ID tenant — no separate paid subscription needed to register the OneDrive app). OneDrive's connect flow was verified live end-to-end against a real Microsoft account. Not yet verified: OneDrive push/pull/conflict handling against real data (Dropbox's was verified during Phase 3), and the QR/link add-device flow scanned from a genuinely second device.

**Not yet started**: wiring the remaining 9 storage-shaped ports (songs/services/slides/media/themes/people/announcements/diagnostics — currently stubs for `kind === 'tablet'`) is what makes the tablet build usable for anything beyond Settings and sync; PWA packaging (manifest, icons, service worker, install prompt) and sync triggers (visibility/focus/timer/manual/debounced-post-save); and a real-device hardening pass (OPFS quota/eviction behavior on iOS/Android, install flow, OAuth redirect round-trip, backgrounded-tab gaps) — see the "Open risks" section of the design plan this was built from for the full list.

**All 9 remaining storage-shaped ports wired, August 10, 2026** (Phase 4 of the design): `songs`/`services`/`slides`/`media`/`themes`/`people`/`announcements`/`diagnostics` in `adapters/tablet/index.ts` are now the same mechanical reuse the settings port already was — the unmodified `web/*.ts` factories, called against the dirty-tracking-wrapped OPFS root instead of a picked folder, exactly as planned (no changes needed to any of those factories themselves). New `adapters/tablet/localMediaRoot.ts` is the tablet build's `LocalMediaRootPort` — a second OPFS subfolder (`local-media/`) built off the *raw*, untracked root, so `'local'`-location media structurally cannot leak into a push; unlike the picker-based web build's equivalent, it never prompts (OPFS grants silently). `diagnostics` is a close copy of the web adapter's own inline implementation, `installationMode: 'tablet'`. `LibrarySyncSection.vue`'s "Data tools" panel is no longer gated off for `kind === 'tablet'` — Load Sample Data, Add Stock Backgrounds, Import OpenSong, and Clear Existing Data all work there now. Media's size-gating (skip caching oversized files) and upload-session chunking needed no new work here — both already lived in the sync layer (`cloudSync.ts`/`providers/*.ts`), not the port layer, from Phases 1–2.

`index.spec.ts`'s placeholder "not-yet-implemented storage port throws" test was replaced with real coverage: a song save/list round-trip, a `diagnostics.getSummary()` check, and a test confirming a `'local'`-location media commit never marks anything under `local-media/` dirty. Full validation: `type-check`, `lint`, the full `test:unit` suite (499 passed), a production `build`, and `cargo fmt --check`/`clippy -D warnings`/`test` (171 passed, unaffected — this phase touched no Rust code) all clean.

**Still not started**: PWA packaging (manifest, icons, service worker, install prompt) and sync triggers (visibility/focus/timer/manual/debounced-post-save push); real-account verification of OneDrive push/pull/conflict handling and the QR/link add-device flow scanned from a genuinely second device; and the real-device hardening pass (OPFS quota/eviction behavior on iOS/Android, install flow, OAuth redirect round-trip, backgrounded-tab gaps).

## Testing and release hardening

### Windows E2E stays manual, not CI

Decided August 8, 2026: the native WebdriverIO/Tauri suite under `e2e/` stays a manually run pre-release check rather than moving into the normal CI workflow (which continues running frontend unit tests and Rust tests only). Run it deliberately before cutting a release, covering at least:

- First launch and setup completion
- Create, save, close, reopen, and edit a service
- Song or slide save/reload
- Media import and live display
- Presentation-window creation
- Report generation and save/open flow
- Remote server startup and basic authorization
- Portable machine-settings behavior

### Real-hardware test matrix

Before a stable release, manually test:

- Projector absent at startup and connected afterward
- Projector disconnected during use
- Display renumbering after reboot, docking, or cable changes
- 100%, 125%, and 150% Windows scaling
- Mixed-resolution and mixed-scaling monitors
- 16:9, 16:10, and 4:3 audience outputs
- Installed and portable instances running together
- Multiple Worship Studio computers on one LAN
- Configured and automatically selected port conflicts
- mDNS discovery across typical church network equipment
- A library hosted in Dropbox or OneDrive during concurrent edits
- Missing local media on a preparation computer
- Upgrade installation over an existing version
- Power loss or forced termination during save
- Network loss while resolving scripture or refreshing Canva
- Canva authorization expiration and reconnection

### Accessibility and interaction review

Perform a focused pass for:

- Keyboard-only operation
- Visible focus indicators
- Correct focus placement when dialogs open and close
- Accessible names for icon-only controls
- Color contrast in light and dark modes
- Meaning that does not depend on color alone
- Screen-reader labels for custom cards, drag handles, and controls
- Reduced-motion behavior
- Text scaling and Windows display scaling

### Diagnostics

Status: completed August 1, 2026.

Settings > About now provides:

- Open Logs Folder
- Copy Diagnostic Summary
- Export Diagnostic Bundle
- Application version, build profile, operating system, and architecture
- Installed/portable status, library readability and item counts, sync/recovery counts, display-assignment count, and port modes
- Size-limited, redacted Rust log excerpts in the exported JSON bundle

The diagnostic payload is allowlist-based. It deliberately excludes settings files, configured paths, church content, people records, computer/device names, network addresses, credentials, and authorization-token files. Release builds now retain up to four 500 KB local Rust logs so field reports have useful evidence without unbounded storage growth.

## Security review

Before broader public distribution:

- Verify that plaintext credentials follow the documented trusted-church-library boundary and never enter logs or diagnostics.
- Review remote-control authentication, cookie behavior, token revocation, and LAN threat assumptions.
- Review whether HTTP-only LAN control is acceptable and document the boundary.
- Narrow the disabled Content Security Policy if practical.
- Narrow the unrestricted Tauri asset-protocol scope if practical.
- Confirm that no private code-signing key is tracked or packaged. The public `.cer` may be tracked; the `.pfx` must remain private and ignored.
- Review temporary Canva downloads and deletion behavior.
- Verify that exported reports cannot overwrite files without an explicit native save choice.

## Licensing and distribution follow-up

- Confirm the ESV API attribution and app-link interpretation directly with Crossway before shipping.
- Confirm api.bible attribution and translation-selection restrictions.
- Retain licenses for all bundled fonts and dependencies in distributed artifacts or an About/Credits location as required.
- Document that locally imported Bible translations are supplied and licensed by the user.
- Decide whether the current self-signed Windows certificate process is acceptable for the intended audience.
- Decide when macOS signing and notarization become necessary.

## Documentation drift

The README and architecture plan contain historical statements that no longer match the implementation, including claims that several adapter areas are still mock-only.

Update:

- `README.md`
- `notes/architecture-plan.md`
- `notes/release-process.md`
- Feature-support and platform-support matrix
- Installed versus portable behavior
- Remote-control discovery and port behavior
- Canva setup and credential expectations
- Backup/recovery guidance

## Remove development-era compatibility before 1.0

Worship Studio does not need to preserve compatibility with data formats produced during pre-1.0 development. Once the 1.0 library and machine-settings formats are finalized, remove the migrations and compatibility paths accumulated while the application was changing.

This cleanup should include:

- Legacy model fields retained only for migration, including old credential and settings locations.
- Load-time migrations, backfills, aliases, and fallback behavior for obsolete pre-1.0 JSON shapes.
- One-time conversion flags and code paths that can no longer be reached by a clean 1.0 installation.
- Tests whose only purpose is preserving compatibility with an abandoned development format.
- Comments and UI messages that describe upgrade behavior no longer supported by 1.0.

Do this after the final schemas are settled, not piecemeal while they are still changing. Before removing a path, confirm that any data worth keeping in the active development library has been converted or can be recreated. Then validate 1.0 using a clean installation and newly created library as the supported baseline.

This does not apply to user-facing imports such as OpenSong or to migrations deliberately introduced after 1.0. From 1.0 onward, persisted-format changes should have explicit versioning and supported upgrade rules.

## Recommended execution order

1. Atomic saves, corruption detection, backups, and recovery — completed August 1, 2026
2. Standard loading, error, and save-failure handling — completed August 1, 2026
3. Replace undo toasts with editor-scoped undo/redo history and visible controls — completed August 1, 2026
4. Pre-service readiness check — completed August 1, 2026
5. Library Health and Sync Conflicts redesign — completed August 1, 2026
6. Credential boundary and focused security review — completed August 1, 2026
7. Honest email/copy/mail-client workflow — completed August 1, 2026
8. Manual Windows E2E pre-release run and real-hardware testing (deliberately not CI — decided August 8, 2026)
9. Local Bible-file import
10. Web-based prep build: File System Access storage layer, conflict-detection ported to TypeScript, Bible API key wiring, Window Management API monitor labeling
11. Full automated help-video generation
12. Automatic updates — deprioritized August 8, 2026; user-accessible diagnostics already completed August 1, 2026
13. Finalize the 1.0 persisted schemas and remove development-era compatibility code
14. Documentation and licensing reconciliation

## Suggested milestone split

### 0.5.x polish

- Sync Conflicts redesign
- Shared loading/error/empty/not-found states
- Editor-scoped undo/redo with app-bar buttons and keyboard shortcuts
- Removal of expiring undo toasts as the primary undo mechanism
- Honest email/copy/mail-client workflow
- Pre-service readiness check
- Documentation correction
- Hardware testing and bug fixes

### Before 1.0

- Credential-boundary verification and rotation documentation
- Updater or a deliberate documented alternative — deprioritized, see below
- Manual Windows E2E pre-release run (deliberately not CI)
- Diagnostics export
- Licensing confirmation
- Security review
- Final schema cleanup with pre-1.0 migrations and compatibility fields removed
- Local Bible-file import
- Full automated help-video generation
- Web-based prep build (§7 split): File System Access storage layer, conflict-detection ported to TypeScript, Bible API key wiring, Window Management API monitor labeling

### Candidate post-1.0 work

Deferred by explicit decision (confirmed August 8, 2026) — only reconsidered if a real church need surfaces:

- Sheet-music PDF mapping
- Built-in email delivery
- Additional song import/export formats (ChordPro import, plain-text paste/parse, OpenSong XML export)

## Completion criteria

Worship Studio is ready for a stable release when:

- A failed or interrupted save cannot silently destroy or hide library data.
- Every major asynchronous operation has a visible loading, success, or failure outcome.
- Synced integration credentials and local authorization tokens follow the documented boundary and never appear in logs or diagnostics.
- The operator can verify service readiness before presenting.
- A projector can be connected or changed without restarting the app.
- The critical Windows workflow passes a manual E2E pre-release run and the hardware matrix.
- A clean 1.0 installation uses the final persisted formats without development-era migration or compatibility code.
- No visible control claims to perform an action that is not implemented.
- Remaining incomplete features are hidden, clearly labeled, or explicitly deferred.
- Documentation accurately describes installed, portable, remote, reporting, and update behavior.
- The remaining older states and Sync Conflicts screen match the established application design.
