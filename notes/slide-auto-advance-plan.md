# Slide Auto-Advance & Looping — Design Notes

Status: as of 2026-08-12, built. Split out from `notes/background-audio-plan.md`: auto-advance/
looping is its own standalone capability, useful whether or not background audio (a separate,
related plan) ever gets built — a looping pre-service slide sequence needs nothing
audio-related at all.

## Implementation summary

- `AutoAdvanceConfig` (`{ intervalSeconds: number; loop: boolean }`, `src/models/library.ts`) is
  shared by two fields:
  - `ServiceItem.autoAdvance?: AutoAdvanceConfig` (`src/models/service.ts`) — the per-service
    override, configured in the "Auto-Advance" section of `PropertyInspector.vue` (only shown for
    `text-slide`/`slide-ref` items — see "Open question, resolved" below).
  - `SlideLibraryItem.autoAdvance?: AutoAdvanceConfig` (`src/models/library.ts`) — the reusable
    item's own default, configured the same way in `SlideEditorView.vue` (shown only when the
    item has more than one slide). `loop` here is fully independent of the override's `loop`: a
    library item can default to playing through once (a photo slideshow meant to show only once)
    just as easily as looping indefinitely (a pre-service announcement loop) — enabling a default
    doesn't imply looping.
  - Resolution (`useLiveTransport.ts`'s `liveItemAutoAdvance`, and mirrored for the UI hint in
    `ServiceWorkspaceView.vue`'s `selectedItemLibraryAutoAdvance`): the ServiceItem's own
    `autoAdvance` wins if set; otherwise, for a `slide-ref` item only, falls back to the
    referenced SlideLibraryItem's own default. `text-slide` has no library item to fall back to,
    so it's override-only. `PropertyInspector.vue` shows "Using this slide's own default: Ns,
    looping" as a hint when the override is off and a library default exists.
  - Both are mirrored in `src-tauri/src/models.rs` as a shared `AutoAdvance` struct (`loop` is a
    Rust keyword, so the struct field is `looping` with `#[serde(rename = "loop")]`) — this
    replaced a pre-existing, never-wired-up `SlideLibraryItem.loop` field (`{ enabled,
    secondsPerSlide, countdownOverlay }`) that had been in the data model since the project's
    original scaffold. Its `countdownOverlay` sub-field was dropped outright rather than
    migrated: nothing ever read it, and the real countdown feature was later built as
    `SlideCountdownElement` (a proper scene element with `mode: 'service' | 'custom' | 'days'`,
    `mode: 'service'` resolving the target time live from whichever service a slide ends up in) —
    a strictly more capable mechanism than the old field's "confirm a fixed target time per use"
    idea ever was.
- The timer itself lives in `useLiveTransport.ts`, as one self-rescheduling `setTimeout` (not a
  persistent `setInterval`) driven by a watch on `[flatIndex, isPresenting, liveItemAutoAdvance]`
  — each tick calls the existing `next()` (only ever while still short of the item's own last
  slide) or jumps back to the item's first slide when looping; either one changes the live
  position, which re-triggers the watch and schedules the next tick fresh. An operator navigating
  away manually clears it the same way, via the same watch — no separate cancel path needed.
  `liveItemAutoAdvance` is its own computed (not just watching `flatSlides`) so toggling
  autoAdvance on the item that's *already* live takes effect immediately, since flattenService
  never reads that field and so flatSlides' own shape wouldn't otherwise change from editing it.

## Why this exists

Every slide transition in the app today is operator-triggered — there is no timer or
auto-advance mechanism anywhere in `useLiveTransport.ts` (`goLive`/`next`/`previous` are purely
keyboard/remote/UI-click driven, immediate and synchronous). That means something like a
pre-service "we'll begin shortly" slide sequence, or any set of slides meant to cycle on their
own before an operator needs to step in, currently has to be advanced by hand or just left on one
static slide.

## Current state (confirmed by reading the actual code, not assumed)

- **Items already know which slides are theirs.** Multi-slide item types (`song` via its
  `arrangement.sequence`, `text-slide` via its own `slides` array, `slide-ref` via a pointer to a
  `SlideLibraryItem`, `sermon` via `passages`/`outline`/`flow`) each store their own sub-content
  inline on the item. `flattenService.ts` walks these into one flat `FlatSlide[]` list, and every
  `FlatSlide` already carries `itemIndex`/`itemId` back to its source item. So "is the live slide
  still inside item N" is already a cheap check (`flatSlides[flatIndex]?.itemIndex === N`) — this
  is what lets an auto-advance timer know when the operator has manually navigated away and should
  stop itself, with no new item↔slide relationship needing to be invented.
- **No auto-advance mechanism exists anywhere.** This is new territory in `useLiveTransport.ts`,
  not an extension of something partial.

## Proposed shape

An optional `autoAdvance` config on actual slide content (`text-slide`/`slide-ref`):
`{ intervalSeconds: number; loop: boolean }`. When set, live transport advances through *that
item's own* slides on a timer instead of waiting for the operator, optionally looping back to
the first slide once it reaches the last. Deliberately excludes song/scripture/sermon even
though each can produce multiple slides — those are normally paced live by whoever's leading
them (singers, a reader, the preacher), not cycled on a timer; this is for slide content nobody
is actively pacing, like a pre-service loop.

- New timer in `useLiveTransport.ts` that calls the existing `next()`, gated on "are we still
  inside the item that started it" (the `itemIndex` check above) — an operator manually navigating
  away (previous/next, jumping to another item, selecting a different item in the order of
  service) always stops it correctly, with no separate "cancel auto-advance" action needed.
- **Looping is indefinite, stopped only by the operator advancing to a different item** — no
  "loop N times" — matching the same decision made for background audio's own looping, for the
  same reason (simpler, and covers the motivating use case without adding play-counting logic).

## Open question, resolved

- **Fixed interval per item, not per-slide** — kept as originally leaning: the motivating use
  case (pre-service cycling) doesn't need per-slide timing, and a single `intervalSeconds` on
  the item keeps the config (and its UI) simple. Revisit if a real need for per-slide durations
  shows up.
- **Eligible item types**: `text-slide`/`slide-ref` only. Song, scripture, and sermon are all
  excluded, even though each can produce multiple slides — they're normally paced live by
  whoever's leading them, not cycled on a timer. The UI section only appears for the two
  eligible types (`PropertyInspector.vue`'s `AUTO_ADVANCE_TYPES`).

## Relationship to background audio

`notes/background-audio-plan.md` covers a separate, related capability (`backgroundAudio`) that
can optionally be paired with an `autoAdvance` item (e.g. looping pre-service slides with music
underneath) but doesn't require it, and vice versa — an item can have either, both, or neither.
