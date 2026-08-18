# Guiding First-Time Setup Decisions — Design Notes

Status: as of 2026-08-17, early discussion only. Nothing decided, nothing built. This document
exists so the conversation can be picked back up later without re-deriving it from scratch.

## Why this exists

A first-time install has to make several decisions that genuinely vary by situation — what kind
of device this is, whether it's the main presentation computer or a secondary/planning device,
whether it's portable, and what (if any) sync provider is in play. Today the wizard doesn't ask
about most of these explicitly; the goal discussed here is making first-time setup actively guide
a user toward the right choices for their situation, rather than presenting the same generic flow
to everyone.

## Current state (confirmed by reading the actual code, not assumed)

- **`BootGate.vue`** already does almost exactly this, but only for the web/tablet builds: its
  chooser ("Open Your Library Folder" / "Connect Dropbox" / "Connect OneDrive" / scan-to-connect
  paste-a-code / "Try the Demo") branches on device type and sync provider before anything else
  loads. Tauri (`isTauri()`) skips this chooser entirely and resolves straight to `ready`.
- **`SetupWizardView.vue`** (the desktop wizard, steps: Welcome → Church → Displays → Library →
  Preferences → Finish) treats every desktop install identically:
  - Display Setup always shows, even for a machine that will never present to an audience.
  - The sync-provider/portable/new-vs-joining-existing decision is squeezed into one generic
    "Shared library folder" card in the Library step — a Browse button and a Portable button, no
    explanation of what either implies or why you'd pick one.
- **Concrete gap**: a second desktop computer joining an already-running church library has no
  guided path at all. Tablet/web already solved this with "Add Another Device" scan-to-connect
  (`LibrarySyncSection.vue` generates the code, `BootGate.vue` consumes it); the desktop wizard has
  no equivalent — someone setting up computer #2 has to already know to point Library Path at the
  exact same folder computer #1 uses.

## Threads explored

### Device role gating which steps show

Whether this computer presents to an audience (relevant: Display Setup) vs. is for
planning/prep only (Display Setup is irrelevant, possibly skippable) was raised as one of the
early branching questions. Not resolved: whether "presents to an audience" should be a one-time
wizard-time question, or a persisted setting that also simplifies Settings' own Display/Remote
Control sections afterward for a planning-only machine.

### Cross-device path mismatch

Reusing tablet's "Add Another Device" connect-code idea for desktop as-is would be wrong: tablet's
code carries a path *relative to the cloud account root*, resolved through the provider's API —
portable by construction, since every device in that flow talks to the same account via OAuth.
Desktop has no cloud API integration at all (deliberately — it just reads whatever the OS-level
Dropbox/OneDrive client has already synced to a real local folder), so the local absolute path is
a function of that specific machine's Windows username, drive letter, and (for OneDrive) sometimes
an org-name suffix — nothing guarantees it matches a second computer.

A discussed fix: a desktop connect code would carry the provider + a path *relative to that
provider's own root*, and the receiving computer would try to auto-detect where its own
Dropbox/OneDrive root actually lives (Dropbox writes a local `info.json` with its real configured
path; OneDrive exposes its local sync root(s) via environment variables it sets itself). Combine
detected-root + relative-subpath, then validate before trusting it (check for
`library-settings.json`/`credentials.json` there) rather than assume it's right, falling back to
manual Browse otherwise. Explicitly not verified against a real installed client yet — flagged as
needing real confirmation before relying on it, same caution as the earlier Dropbox
ignore-attribute research this project already did for the Local-folder work.

### No Dropbox/OneDrive installed at all → Worship-Studio-controlled sync

Raised scenario: a desktop user who doesn't have any provider's desktop client installed and wants
tablet-style direct sync instead. Initial reaction (wrong, corrected below) was that this is
blocked by tablet's sync engine being OPFS-specific.

**Correction, confirmed by reading `adapters/tablet/cloudSync.ts` and
`adapters/tablet/providers/types.ts`:** the engine operates against a `FileSystemDirectoryHandle`
— the same Web File System Access API type returned by `showDirectoryPicker()` for a *real*
folder, which is exactly what the plain "web" adapter already uses with no cloud API involved at
all. OPFS is just which concrete handle the tablet adapter happens to hand this engine, not
something baked into the engine. The actual sync logic — provider-agnostic cursors/pagination via
the `CloudSyncProvider` interface (`dropbox.ts`/`onedrive.ts`), conflict-artifact writing,
exponential backoff, token-refresh de-duplication — has no OPFS dependency.

So this is not blocked, it's a real, scoped engineering project: reimplement OAuth + the
`CloudSyncProvider` protocol logic (already proven out by the tablet adapter) against Rust/native
files instead of a browser directory handle — consistent with how everything else file-related in
this app already lives in Rust rather than browser APIs (this app's Tauri adapter doesn't use FSA
anywhere today; folder access goes through `@tauri-apps/plugin-dialog`). Whether WebView2 actually
supports FSA well enough to reuse the TypeScript engine more directly was raised but not checked —
the Rust-port approach was favored regardless, for architectural consistency with the rest of the
codebase (everything in `src-tauri/src/paths.rs` and `domain/*.rs`).

### Provider sync vs. app-controlled sync — main computer vs. secondary devices

Working hypothesis (not decided): provider sync (today's model) is probably right for the *main*
presentation computer; Worship-Studio-controlled sync has genuine advantages for *secondary*
devices.

**Why provider sync fits the main computer:**
- Syncs continuously in the background independent of whether Worship Studio is even running — if
  the app restarts or crashes mid-service, the OS client keeps pulling/pushing regardless.
- Everything available offline by default, not a selectively-cached subset.
- Other tools on that machine (Canva, File Explorer, backup software) see the same real, natively
  synced files for free.
- Dropbox/OneDrive's own teams maintain the genuinely hard parts (huge files, flaky networks,
  sleep/wake, rate limits) as their full-time job.

**Why app-controlled sync could be better for secondary devices:**
- Structurally solves the "Local must never sync" problem this project already spent real effort
  on (see the Local-folder-restructuring discussion, same conversation) — if the app only ever
  pushes/pulls files it explicitly decides to sync, Local (machine-settings.json, canva-auth.json,
  local media) can't leak into the cloud by accident. No ignore-attribute, no folder-placement
  discipline required.
- Solves the cross-device path mismatch cleanly via OAuth + account-relative paths, same as
  tablet already does — makes "Add Another Device" trivially reliable instead of needing the
  detect-and-validate approach described above.
- Setup collapses to one sign-in inside the app, not a separate client to install and configure
  correctly — real friction reduction for a less technical volunteer setting up a secondary
  machine.
- The app would know its own real sync state (pending pushes, last synced time) instead of
  inferring from "does a sync client process appear to be running," which is all
  `domain::sync`/Sync health can do today for the OS-level-sync case.

### Live-update-while-running

Raised question: does the running app notice changes made by another device while it's open?
**Confirmed by reading the code: no, for either sync model, today.** No `notify`-based file
watcher exists anywhere in the Rust backend (`src-tauri/src`); the one polling loop on the
frontend (`stores/sync.ts`) is tablet-specific and only shows progress of a sync that's already
running, not general change detection. A change made elsewhere is only picked up when something
explicitly triggers a reload — navigating to a page whose store re-fetches on mount, or clicking
Check Now/Sync Now.

This splits into two separate concerns that had been conflated:
1. Does content stay fresh **on disk** in the background — yes for the OS client (even with the
   app closed); only while running for an app-controlled engine, unless it also grows a background
   service.
2. Does the **running app actively notice and react** — no for either model today.

App-controlled sync was noted as the more natural foundation for eventually fixing (2), since
`cloudSync.ts` already runs an active pull loop and knows precisely when new content arrived —
wiring that into "refresh the relevant store now" extends something that already exists. Doing the
same for OS-level sync would mean bolting on an unrelated mechanism (a Rust file watcher) just to
notice that Dropbox/OneDrive touched a file. Still, a Rust file watcher for OS-level sync is a
possible independent improvement, unrelated to which sync backend is chosen.

### Live-refresh safety, if it's ever built

Two real hazards were raised and largely agreed on:

- **Conflict risk depends on what gets refreshed.** Safe for idle/unedited content (e.g. a new
  song appearing in the list while just browsing). Unsafe for anything with an open, unsaved local
  edit — this project already did real work isolating a dialog's local draft from the live store
  (`structuredClone(toRaw(...))`, "Cancel discards cleanly" — see the font-size/bulletin nesting
  work earlier this session) specifically so nothing else can silently touch it mid-edit. A naive
  live-refresh that overwrites the underlying record while it's open in an editor would undermine
  that protection and manufacture a conflict that wouldn't otherwise exist yet. Conclusion: refresh
  what's idle, leave anything with an open unsaved draft alone until it's saved or discarded.
- **Should not run during an active presentation at all**, for stability, not just conflict risk —
  background I/O, retry/backoff cycling, or an unexpected conflict prompt while someone is
  actively driving slides live is a real risk for close to zero benefit (service content is locked
  in by that point). The app already models a distinct "currently presenting" state — referenced
  in `remote_server.rs`'s access-control tests ("blocks only while presenting") — which is the
  natural existing gate: live-refresh, whenever it exists, should stay quiet while that's true.

## Not yet decided

Everything above is exploratory. In particular, still open:
- Whether "presents to an audience" becomes a persisted setting or stays a one-time wizard
  question.
- Whether to actually build Worship-Studio-controlled sync for desktop at all, and if so, for
  which use case (no-provider-installed users, secondary devices only, or as a real alternative
  for the main computer too).
- Whether to pursue the auto-detect-provider-root approach for a desktop connect-code flow, or
  keep it manual (share provider + relative path as guidance only, no automatic detection).
- Whether live-refresh (idle content only, paused while presenting) is worth building at all, or
  stays a "nice to have, not now."

No implementation should start on any of this without explicit go-ahead — see the conversation
this was extracted from.
