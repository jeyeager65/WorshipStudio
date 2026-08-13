# Slide Transitions — Design Notes

Status: as of 2026-08-12, early design — nothing built yet. This is a working document, not a
final spec.

## Why this exists

Every slide change today — operator-triggered now, potentially timer-triggered once
`notes/slide-auto-advance-plan.md` lands — is an instant cut on the audience-facing output, with
zero animation anywhere in the rendering path.

## Current state (confirmed by reading the actual code, not assumed)

- **`SlideContentRenderer.vue` has no transition logic at all** (confirmed via grep, no
  `transition`/`Transition` matches) — it's the single shared rendering funnel used by the Tauri
  presentation window, the web audience window, and the Remote Control phone mirror.
- **Both audience-facing surfaces reassign content directly, with no wrapper:**
  - `PresentationView.vue` (Tauri desktop): listens for the `live:slide-changed` IPC event and
    does `current.value = event.payload ?? undefined`, rendered as
    `<SlideContentRenderer :content="current" />` — no `<Transition>` anywhere.
  - `WebAudienceView.vue` (browser/PWA/tablet): identical pattern, sourced from a
    `BroadcastChannel` message instead of a Tauri event.
  
  Both are thin wrappers around the exact same `<SlideContentRenderer :content="current" />` line
  — a transition wrapper added once, at this shared point, automatically covers every content
  path with no per-surface duplication.

## Decisions made

1. **Applies uniformly to every service item type that produces slides** — songs, scripture,
   sermon, text-slides, slide-ref, media (image/video), wayfinding — not scoped to some subset.
   Confirmed by the user explicitly. This rules out attaching the transition style to `Theme`
   (`src/models/library.ts`), even though themes already carry other per-content-type visual
   config (`textEffect`, `backgroundColor`, etc.) via `PresentationThemeTarget` — themes only
   target `'songs' | 'scripture' | 'sermon' | 'text-slides'`, which would leave media items and
   the wayfinding indicator without a transition, contradicting "any service item." Because
   `SlideContentRenderer` is the one funnel all content already flows through regardless of item
   type, wrapping it once at the presentation-window level is both the simplest implementation
   and the only one that naturally satisfies this requirement — no per-item-type special-casing
   needed.

## Proposed shape

**Always enabled — no settings toggle.** A single cross-dissolve (fade) style, applied globally,
not per-theme, not per-item, not configurable per-service or by the operator.

- **Style: cross-dissolve (fade) only, no slide/push/wipe variants.** Fade is the one style that
  looks reasonable regardless of what's actually on either slide — full-bleed image, video,
  plain text, wayfinding bar over scripture — where directional slide/push effects can look wrong
  depending on background content. Keeping it to one style avoids needing a settings UI.
- **Duration: ~250–300ms.** Fast enough not to feel sluggish when an operator is rapidly clicking
  through slides, long enough to read as intentional rather than a flicker.
- **Audience-facing only — operator-side previews stay instant.** The Previous/Current/Next
  thumbnails in `ServiceWorkspaceView.vue`'s preview panel (also rendered via
  `SlideContentRenderer`) are a monitoring tool, not the audience output — the operator wants
  immediate feedback when clicking through slides, not a delayed transition. Same reasoning for
  the Remote Control phone mirror (`RemoteMirror.vue`): a working tool, not the audience view.
- **Applies to every content swap on the audience surfaces**, not just item-to-item: slide-to-
  slide within an item, going live, clearing/blanking, and Background Only/Blank Screen toggles
  all go through the same `current`/`content` reassignment, so they get the same treatment for
  free with no special-casing — consistent with "instant cut, always" becoming "fades, always."

### What actually fades — and the performance design (important revision)

Visually, the whole slide fades as one unit — text, images, and backgrounds all dip and return
together, so from the audience's perspective "everything transitions." **But the implementation
must not do this by unmounting/remounting `SlideContentRenderer`'s whole subtree on every slide
change**, and the initial sketch of `<Transition mode="out-in">` wrapping the component with an
artificial per-slide key was wrong for exactly that reason — confirmed by reading the actual
template (`SlideContentRenderer.vue` ~line 280-390): the background `<img>`/`<video>` is already
individually `:key`'d to its own `url` (`content.presentationTheme.backgroundMedia.url` /
`content.media.url`), which is what lets a background — e.g. one looping video behind an entire
song — keep playing continuously across that song's slides today, with no restart, as long as the
url doesn't change. A forced outer remount on every slide would destroy that optimization: every
slide change would tear down and rebuild the *entire* tree, restarting any shared background
video from frame 0 every time even when nothing about it actually changed. That class of bug —
redoing more work than actually changed on every transition — is the most likely explanation for
the OpenSong performance complaints referenced during planning; the fix here is architectural, not
"make the animation cheaper."

Revised approach: animate a plain CSS opacity dip on `.slide-root` itself (the existing persistent
root element), sequenced around the *existing* in-place content update rather than replacing it
with a mount/unmount:

1. On content change, add a class that transitions `.slide-root`'s opacity to 0 over ~125ms.
2. Once that fade-out finishes (`transitionend`, not a guessed timeout), update the `content` prop
   as today — a plain reactive prop change, no remount. Any sub-element whose own `:key` (url,
   book name, etc.) hasn't changed is naturally preserved and untouched by Vue, exactly as now.
3. Remove the class, fading `.slide-root`'s opacity back to 1 over ~125ms.

This reads identically to a full crossfade-through-background from the audience's side — and
still gets the same non-overlapping-media guarantee the original `out-in` idea was for (content
only actually swaps at the trough of the dip, so two videos/audio tracks are never both audible
mid-transition) — but costs a single opacity transition on one element plus whatever the
already-existing reactive update costs, with zero extra remount work for anything that didn't
change between the two slides. Opacity is compositor-only in every browser engine involved here
(Chromium/WebView2 for the Tauri build, whatever the tablet's browser is for the PWA), so the
animation itself is cheap regardless of slide complexity.

### A separate, pre-existing gap worth closing alongside this

Grepped for image/video preloading anywhere in the live-presentation path
(`SlideContentRenderer.vue`, `PresentationView.vue`, `WebAudienceView.vue`,
`useLiveTransport.ts`) — **none exists**. Background images/videos load lazily, exactly when a
slide carrying a new url first becomes live. This is already true today with plain instant cuts,
so it isn't a regression this feature introduces — but a fade makes any loading delay *more*
visible than a cut does: fading in over a background that hasn't finished decoding yet looks like
a stutter, which is the same user-facing symptom as the OpenSong complaint even though the root
cause (asset loading, not the transition math) is different. Cheap mitigation, worth doing as part
of this work rather than waiting for a complaint: when a service is opened (or goes live), do a
one-time cache warm-up — `new Image().src = url` (and the video equivalent) for every distinct
background url found across the flattened service — so the browser's own HTTP/decode cache
already has them by the time any slide actually needs one. Distinct backgrounds per service are
typically few (most slides in an item share one), so this is a small, one-time cost, not a
per-slide one.

## Next steps

Implement the opacity-dip approach on `.slide-root` in `SlideContentRenderer.vue` (rather than a
`<Transition>` wrapper in the two parent views, which was the wrong layer once the goal is
"animate without remounting"), add the background-url cache warm-up on service open, and manually
confirm on both the Tauri desktop build and a browser/tablet build that: the fade reads smoothly
at 250–300ms, a shared background video/looping audio survives a same-url slide change without
restarting, and there's no visible pop-in on a first-time background url even right after opening
a service.

## Relationship to other plans

- `notes/background-audio-plan.md` — the `mode="out-in"` choice above is specifically to avoid
  conflicting with that plan's persistent `<audio>`/video playback during a transition.
- `notes/slide-auto-advance-plan.md` — auto-advance calls the same `next()`/live-transport path
  as manual operator navigation, so timer-driven advances get the same fade for free once this
  ships; no coupling required in either direction.
