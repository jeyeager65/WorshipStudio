# Desktop: noticing library changes made elsewhere

Status: **BUILT 2026-08-26.** Design agreed and implemented the same day; kept as the record of
why it works this way, and of the two arguments that changed along the way. Follows on from
[notes/tablet-push-latency-plan.md](tablet-push-latency-plan.md), which fixed the tablet end of the
same chain.

## The gap

A tablet's edit now reaches OneDrive within seconds, and OneDrive's Windows client puts the file in
`…\OneDrive\WorshipStudio\Library` shortly after. **The running desktop app never notices.**

- No filesystem watcher exists in the Rust backend (`notify` is not a dependency).
- Nothing reloads stores on a timer, on focus, or on visibility.
- Views guard their loads — `store.loaded ? Promise.resolve() : store.load()` — so navigating away
  and back does _not_ re-read. Nothing ever invalidates `loaded`.

So the library is read once per app session. A desktop left open all week shows what was on disk
when it started, with no indication anything moved. Restarting is the only refresh.

This also covers a case that has nothing to do with tablets: editing library files directly, or a
second desktop syncing through the same folder.

## Decisions (operator, 2026-08-26)

1. **Editing during a service happens on the presenting machine.** So the desktop is the source of
   truth exactly when it is most critical, and staleness there matters least during a service. The
   watcher earns its keep during the week, not on Sunday.
2. **Prompt; let the operator decide.** Never silently reload underneath someone.
3. **Suppress entirely while presenting, resume once presenting stops.** No interruptions mid-service.
4. **A real filesystem watcher**, not focus-refresh or polling — chosen deliberately over the cheaper
   options, because the case that matters is a window sitting open and untouched, which is precisely
   what focus-based refresh misses.

Note how (1) and (3) reinforce each other: suppressing while presenting costs almost nothing,
because that machine is the one making the changes then.

## Mechanism

**Rust side.** Add `notify` and watch the resolved library root recursively (`library_root()`,
`src-tauri/src/paths.rs` — note it is re-read from machine settings, so the watch has to be
re-established if the library folder changes). Debounce ~1s after the last event, then emit a Tauri
event carrying the changed _library-relative_ paths.

Noise to filter, since a cloud client's writes are messy:

- `.backup` files — this device's own local artifacts, never shared content (same exclusion
  `adapters/tablet/index.ts`'s dirty tracking already makes).
- Anything that is not `*.json` — see "Watch `*.json` only" below, which makes this the primary
  filter rather than an optimisation.
- Temp and partial files (`*.tmp`, `~$*`, `*.partial`, and the provider's own hidden state folders).
- The Local media folder, which is deliberately never synced.
- Writes the app itself just made — otherwise saving a song prompts the operator to reload the song
  they just saved. Handled by comparing content rather than by suppressing writes; see below.

**Frontend side.** Map changed paths to the stores that own them (`songs/` → songs, `services/` →
services, and so on — each web port already knows its own directory, so the mapping exists
implicitly and should be derived from one place rather than restated). Then surface a persistent
snackbar in the same family as the existing reconnect and update banners in `App.vue`: _"The library
was updated somewhere else — Reload"_, never auto-dismissing, with the operator choosing when.

Reloading means calling `load()` on the affected stores only, not a page reload.

## The part that needs the most care: unsaved work

A reload that discards someone's in-progress edit is worse than the staleness it fixes. Two
protections, and the second is the one that actually matters:

- `useUnsavedChangesStore`'s `isDirty` already tracks whether the current editor has unsaved work.
  If it does, the Reload action must confirm explicitly, naming what is at stake, rather than
  quietly proceeding.
- Better still, the reload can skip stores backing an editor that is currently dirty, refresh the
  rest, and leave the banner up for the remainder. Staleness in one editor the operator is actively
  working in is the safest possible failure.

Worth checking whether this should reuse the existing conflict machinery instead of inventing a
second concept — the tablet path already has a real conflict model (`cloudSync.ts`, conflicted-copy
artifacts, `SyncConflictsView`). "The file changed underneath me while I was editing it" is the same
problem the desktop has simply never been able to see.

## Suppressing while presenting

`liveSession`'s `isPresenting` already exists and `App.vue` already hides banners while presenting.
Hold the signal rather than dropping it: keep watching, queue the pending-change state, and surface
the banner once presenting stops. Dropping it would mean a change arriving mid-service is never
mentioned at all.

## Out of scope

- **The web (File System Access) build has the same gap** and no watcher available to it. Nothing to
  do here for now; worth stating so the omission is deliberate rather than forgotten.
- **Automatic merge.** Prompting is the decision; anything cleverer needs the conflict question above
  answered first.

## Open questions, worked through 2026-08-26

### Watch `*.json` only — media binaries are out of scope

Operator's observation, and the code confirms it: `domain/media.rs`'s `replace_from_file` copies the
binary and then calls `save(...)`, rewriting the JSON with a fresh `content_hash`, `updatedAt` and
`updatedByDevice`. `delete`'s own comment calls the metadata "the library's authoritative record."

**So no meaningful media change can occur without its JSON changing** — the hash lives there. A
binary-file event tells us nothing its metadata event does not.

This is worth more than one filter line:

- It removes most of the noise problem. No large binary write events, and none of the chunked churn
  from a cloud client pulling down a video — the main unknown in the noise question below.
- It collapses the write paths back to one. With binaries out of scope, everything the watcher sees
  arrived through `atomic_write_bytes`.

### Self-writes: still compare content, but for a narrower reason

An earlier draft argued against an ignore-window partly because media imports bypass
`atomic_write_bytes` and use `fs::copy` directly, so the hook would need threading through unrelated
call sites. **That argument is void** once binaries are out of scope — there is a single funnel
again.

The remaining objection stands on its own, and is the one that decides it: an ignore-window is racy
in the direction that matters. If the app writes a file and a remote change to that same file lands
inside the window, the window swallows it and the operator is never told. Failing toward "say
nothing" is the wrong bias for the exact problem this feature exists to solve.

**Decide by content, not provenance.** On a watcher event, re-read the changed file and compare
against what the store already holds. Identical means the app wrote it — no prompt. Different means
something real changed — prompt. Correct in precisely the case an ignore-window gets wrong: when the
app and a remote device both wrote, the content differs, so it prompts.

With only small JSON files in scope, the cost is negligible.

### Reusing the conflict model: no, they are different problems

Checked, and conflating them would be a mistake. The existing model (`adapters/web/sync.ts`'s
`CONFLICT_PATTERN`, `detectConflicts`, `SyncConflictsView`) is about **conflicted-copy artifacts the
cloud provider itself creates** when two devices wrote and it could not merge — detected by scanning
for `… (conflicted copy …).json` filenames, with a real choice to make between two saved versions.

This feature's case has no artifact and nothing to reconcile: someone else's write arrived cleanly,
the remote version is simply correct, and the only problem is that the UI is showing something older.

The two only touch when the operator has unsaved edits open _and_ the file changes underneath. Even
then the local edit is in memory and unwritten, so the provider knows nothing and no artifact exists
— the right handling is still "warn before discarding," not the conflicted-copy flow.

### The presentation window: ignore these events entirely

Confirmed — `PresentationView.vue` uses **no stores at all**. It is driven purely by IPC
(`LiveSlideContent`), so it reads none of the affected state and has nothing to refresh. The watcher
event should be handled only in the operator window.

### Cloud-client noise: much smaller now, still worth measuring

Restricting the watch to `*.json` removes the worst of it — the big, chunked, long-running writes
were all binaries. What remains is small metadata files, written rarely.

One filter is known regardless: this app's own atomic writes create `.{file_name}.{uuid}.tmp` beside
the target (`atomic_write_bytes`) — dot-prefixed, `.tmp`-suffixed — so those must be excluded
whatever else the cloud client adds. Still tune the debounce against a real observation, but it is
no longer a design risk.

## Refinement to the prompt (2026-08-26)

Rather than one all-or-nothing Reload: refresh the stores that are _not_ backing a currently-dirty
editor, and leave the banner up for the rest. Staleness confined to the one thing the operator is
actively editing is the safest available failure, and it stops the prompt being a trap when there is
half-finished work open.

## What was built

- `src-tauri/src/library_watch.rs` — a `notify` watcher on the library root, `*.json` only,
  debounced 800ms, emitting `library:changed` with library-relative paths. Filters this app's own
  `.tmp` atomic-write artifacts, `.backup` files, and the never-synced Local media folder.
- `record_write` is called from `domain::atomic_write_bytes`, recording a hash of what the app
  wrote. The watcher drops an event whose file still matches — content, not a time window, so a
  remote change landing while the app writes the same file is still reported. A test pins exactly
  that case.
- `src/utils/libraryChanges.ts` maps changed paths to the stores that own them, and names them for
  the operator ("Songs and services") rather than counting files. Its spec pins every port's
  directory, so renaming one without updating the map fails loudly instead of silently refreshing
  nothing.
- `src/composables/useLibraryChangeWatch.ts` holds pending changes, suppresses them entirely while
  presenting (held, not dropped), and reloads only the affected stores.
- A bottom snackbar in `App.vue`, matching the update/reconnect banners: never auto-applies, offers
  Reload or Dismiss.

### Still worth doing on a real library

- **Measure the noise.** The debounce is a starting guess; only a real OneDrive sync of a real
  library will say whether 800ms is right.
- **Confirm the dirty-editor path by hand.** Unit tests cover the mapping and the self-write
  detection, but "edit a song on the desktop, change it from a tablet, watch what the banner does"
  is the behaviour that matters and it has not been exercised end to end.

## Correction: the unsaved-work protection was unnecessary (2026-08-26)

The design above called for skipping stores behind a dirty editor. Built that way first, then
checked the premise and found it false.

**Editors do not read from these stores.** `SongEditorView` fetches its record with
`getAdapter().songs.get(...)` into a private `ref`; `ServiceWorkspaceView` does the same. A store
reload refreshes the _lists_ and leaves an open editor's draft entirely untouched, so there was
never any unsaved work to lose.

The protection was not merely redundant — it was harmful. `unsavedChanges.isDirty` is one app-wide
flag, so with anything dirty, Reload skipped every store, left them all pending, and the banner
stayed up: a control that visibly did nothing.

Removed. Reload now refreshes everything that changed, unconditionally.

Worth being clear about what this does _not_ change: if two people edit the same record and both
save, the later save wins. That is pre-existing last-write-wins behaviour, unaffected by whether the
list was refreshed, and out of scope here.
