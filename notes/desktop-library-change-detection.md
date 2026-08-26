# Desktop: noticing library changes made elsewhere

Status: design agreed 2026-08-26, not built. Follows on from
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
- OneDrive/Dropbox temp and partial files (`*.tmp`, `~$*`, `*.partial`, and the provider's own
  hidden state folders).
- The Local media folder, which is deliberately never synced.
- Writes the app itself just made — otherwise saving a song prompts the operator to reload the song
  they just saved. Simplest defence is a short ignore-window keyed by path, set when the backend
  writes; worth confirming against how the write commands are structured before committing to it.

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

## Open questions

- Does the self-write ignore-window hold up, or do the write commands need to report their own
  writes explicitly?
- How noisy is OneDrive's client in practice against a real library? Worth measuring before tuning
  the debounce.
- Should the presentation window (a second Tauri window) ignore these events entirely? Almost
  certainly yes, but confirm it does not read the affected stores.
