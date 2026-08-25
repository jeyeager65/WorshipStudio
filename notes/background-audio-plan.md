# Background Audio — Design Notes

> **Post-1.0 — deferred as of 2026-08-25, and not committed work.** This was previously listed
> as a prerequisite for the 0.9.0 church-ready milestone; it no longer is, and neither is Bible
> import. 0.9.0 now waits on documentation alone. The wording that matters is the operator's own:
> these features move to post-1.0 "if they ever get implemented" — so treat what follows as a
> design exploration that may never be built, not as a plan awaiting a start date.
>
> Nothing below is stale in itself; the analysis of the existing `audio` stub still holds. Only
> its priority changed. Re-read the "Why this exists" section against current code before acting
> on it, since the stub may have shifted in the meantime.

Status: as of 2026-08-13, early design — nothing built yet. This is a working document, not a
final spec. Auto-advance/looping used to be covered here too but is now its own doc
(`notes/slide-auto-advance-plan.md`) — it's a standalone capability, useful whether or not
background audio ever gets built, not a prerequisite of this feature.

## Why this exists

`ServiceItem` already has an `audio` variant (`{ type: 'audio', mediaId: string }`,
`src/models/service.ts`), but it's an unfinished stub: no way to add one through the UI, no
playback anywhere in the app (no `<audio>`/Web Audio usage exists at all), and
`serviceReadiness.ts` hard-blocks any service that contains one ("Audio presentation is not
implemented — Remove this item or replace it with supported content"). `flattenService.ts`
doesn't even have a case for it — it falls into the generic placeholder branch and its `mediaId`
is dropped entirely.

## Motivating use cases (from the operator)

1. **Special music** — a backing/accompaniment track plays while someone sings live to it.
2. **Offering** — background music during the offering, likely with no meaningful foreground
   slide content (or a single "Tithes and Offering" bulletin-note-style slide).
3. **No praise team available** — a recorded track plays in the background while the presenter
   manually selects/advances the appropriate lyric slides to match, live, by ear — the audio
   isn't tied to any single slide's timing at all.
4. **Pre-service** — audio playing while pre-service slides are showing. The slides themselves
   cycling on their own is `slide-auto-advance-plan.md`'s concern, not this doc's — but that item
   could also have `backgroundAudio` attached, whether the slides are auto-advancing, being
   clicked through manually, or just sitting on one static slide.

The common thread across all four: **audio tied to one service item, decoupled from which of that
item's own slides happens to be live** — the audio keeps playing while the presenter (or a timer,
if the item also has `autoAdvance` set) moves through multiple slides on top of it.

## Decisions made

1. **Background audio is always operator-started, never automatic.** Going live on an item with
   `backgroundAudio` set does *not* start playback by itself — the operator presses Play (a new
   transport-bar control) when they're actually ready. This matters most for the backup-track
   case: the singer may need a moment to get positioned before the track should start, and
   auto-start would force the operator to work around that every time instead of just controlling
   it directly. One behavior for every use case (special music, backup track, offering, pre-service)
   rather than something conditional per scenario — an operator who wants it to start immediately
   just presses Play right away, which costs nothing.
2. **Looping is indefinite, stopped only by the operator advancing to the next item.** No "loop N
   times" or "stop when the track naturally ends" — just an on/off flag, off by default, that keeps
   the track going until live transport moves to a different item. (Same decision as
   `slide-auto-advance-plan.md`'s own looping, for the same reason.)

## Current state (confirmed by reading the actual code, not assumed)

- **Items already know which slides are theirs**, via `itemIndex`/`itemId` on every `FlatSlide`
  (`flattenService.ts`) — see `slide-auto-advance-plan.md` for the full detail; the same fact is
  what lets background audio know "we're still within the item that started it" as the operator
  moves between that item's own slides.
- **The presentation window is persistent, not re-rendered per slide.** `PresentationView.vue`
  (Tauri) and its web equivalent hold one `SlideContentRenderer` instance for the window's entire
  lifetime and just reassign its `content` prop on each slide change (via a Tauri IPC event /
  `BroadcastChannel`). This means a persistent `<audio>` element *can* live alongside it and
  survive slide transitions within an item — but `LiveSlideContent` (the payload sent to that
  window) doesn't currently include `itemId`/`itemIndex` at all, so the presentation window has no
  way today to know "we're still in the same audio-owning item" vs. "a new item went live, stop/
  change the audio." That field needs adding to the payload.
- **Remote Control only mirrors discrete snapshots, on a 300ms poll.** No push/event mechanism,
  and nothing models continuous/streaming state (playback position, etc.) today. Given audio plays
  through the room's own speakers (not through a phone), the recommendation is that **Remote
  Control needs no changes for this feature** — see "Out of scope" below.
- **The readiness blocker is a single, easy-to-find rule** —
  `serviceReadiness.ts` (`item.type === 'audio'` branch) unconditionally adds a `blocker`-severity
  issue. Straightforward to remove/replace once real playback exists; the existing
  `checkMedia(item.mediaId, ...)` call right above it (verifying the referenced media resolves)
  is still exactly the right check to keep.

## Proposed shape

An optional `backgroundAudio` config addable to any item type: `{ mediaId: string; loop: boolean }`.
Drives a persistent `<audio>` element in the presentation window (and the operator's own preview,
for monitoring). Playback is operator-started (a Play control appears once such an item goes live
— see "Decisions made") and stops automatically when live transport moves to a *different* item
(via the `itemIndex` check), regardless of how many of the item's own slides the operator clicks
through in between (or how those slides are being advanced — manually, or via
`slide-auto-advance-plan.md`'s `autoAdvance`), or is stopped/paused directly by the operator at
any time. This is the real implementation of the existing `audio` item type's *intent*, but
generalized so it can sit alongside slide content instead of only working as its own standalone
item.

### Live transport / presentation window changes

- Add `itemId`/`itemIndex` to `LiveSlideContent` (`adapters/types.ts`) so the presentation window
  (and web audience view) can tell whether a slide change is still within the audio-owning item.
- Persistent `<audio>` element added as a sibling to `SlideContentRenderer` in
  `PresentationView.vue` and the web audience view equivalent, driven by `backgroundAudio` state
  keyed off `itemId` rather than remounted per slide. A new Play/Pause transport-bar control
  (only shown when the live item has `backgroundAudio` set) is the operator's explicit start
  trigger — going live on the item alone never starts playback (see "Decisions made"); moving to
  a different item always stops it, whether or not the operator ever pressed Play.
- Readiness: remove the unconditional `unsupported-audio` blocker once real playback exists; keep
  the existing `checkMedia` file-resolves check for both `audio`-only items and any item with
  `backgroundAudio` set.

### Out of scope for this feature

- **Remote Control reflection of audio state.** The existing mirror mechanism (300ms HTTP polling
  of discrete snapshots) has no way to usefully carry continuous playback state, and audio plays
  through the room's own output, not through a phone — there's nothing for a remote viewer to do
  with "audio is playing." If this turns out to be wrong (e.g. an operator wants a remote mute
  button), that's a separate, later conversation.
- **Volume/fade controls, ducking under speech, multi-track mixing.** Not mentioned as a
  requirement; a single mediaId with loop on/off is the whole scope unless that changes.

## Next steps

Flesh out the exact TypeScript shape for `backgroundAudio` on `ServiceItem` and its Rust mirror
(`src-tauri/src/models.rs`), design the "Add Audio" / "add background audio to an existing item"
UI (likely in `AddServiceItemDialog.vue` and the per-item editor in `ServiceWorkspaceView.vue`),
design the new transport-bar Play/Pause control, and confirm how a service's *own* volunteer-facing
bulletin/order-of-worship text (`orderOfWorship.ts`) should describe an item that has background
audio attached.
