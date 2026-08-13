# Slide Auto-Advance & Looping — Design Notes

Status: as of 2026-08-13, early design — nothing built yet. Split out from
`notes/background-audio-plan.md`: auto-advance/looping is its own standalone capability, useful
whether or not background audio (a separate, related plan) ever gets built — a looping
pre-service slide sequence needs nothing audio-related at all.

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

An optional `autoAdvance` config on any item type that already produces multiple slides (`song`,
`text-slide`, `slide-ref`, `sermon`): something like `{ intervalSeconds: number; loop: boolean }`.
When set, live transport advances through *that item's own* slides on a timer instead of waiting
for the operator, optionally looping back to the first slide once it reaches the last.

- New timer in `useLiveTransport.ts` that calls the existing `next()`, gated on "are we still
  inside the item that started it" (the `itemIndex` check above) — an operator manually navigating
  away (previous/next, jumping to another item, selecting a different item in the order of
  service) always stops it correctly, with no separate "cancel auto-advance" action needed.
- **Looping is indefinite, stopped only by the operator advancing to a different item** — no
  "loop N times" — matching the same decision made for background audio's own looping, for the
  same reason (simpler, and covers the motivating use case without adding play-counting logic).

## Open questions

- **Is the interval fixed per item, or could individual slides within the sequence need different
  durations** (e.g. a longer welcome slide, a shorter "turn off your phones" reminder)? The
  motivating use case (pre-service cycling) doesn't obviously need per-slide timing, but it's
  worth confirming before locking in a single `intervalSeconds` on the item as a whole.

## Next steps

Flesh out the exact TypeScript shape for `autoAdvance` on `ServiceItem` and its Rust mirror
(`src-tauri/src/models.rs`), decide the per-item vs. per-slide interval question above, and design
where the operator configures it (likely the per-item editor in `ServiceWorkspaceView.vue`).

## Relationship to background audio

`notes/background-audio-plan.md` covers a separate, related capability (`backgroundAudio`) that
can optionally be paired with an `autoAdvance` item (e.g. looping pre-service slides with music
underneath) but doesn't require it, and vice versa — an item can have either, both, or neither.
