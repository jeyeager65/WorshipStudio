<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { wrapLineAtPunctuation } from '@/utils/textAutoFit'
import { OLD_TESTAMENT_FRACTION } from '@/utils/scriptureReference'
import { presentationTextShadow } from '@/utils/presentationTextEffect'
import type { LiveSlideContent, ScriptureTextSegment } from '@/adapters/types'
import SlideSceneRenderer from '@/components/slides/SlideSceneRenderer.vue'

/**
 * Renders one slide's content — the audience-facing presentation window (full window, real
 * size) and the operator's Previous/Current/Next preview thumbnails (small, fixed virtual
 * size + visually scaled down) both use this same component, so the auto-fit sizing/wrapping
 * logic and slide-type branching only exist in one place.
 *
 * `fixedSize`, when given, renders the root at that literal pixel size regardless of its
 * actual on-screen box (the parent is expected to wrap it in a smaller box with
 * `overflow: hidden` and a CSS `transform: scale(...)`) — this is what makes a thumbnail a
 * true miniature of the real thing: the exact same auto-fit math (which cares only about the
 * root's own clientWidth/clientHeight) runs against the same reference size the real
 * presentation window would typically have, so the *proportions* it decides on (how large text
 * gets, whether a song line wraps, etc.) match what the audience actually sees — only the
 * final visual size differs. Without this, an absolute px min/max font range (e.g. scripture's
 * 28-72px) would mean almost nothing at true thumbnail size: it'd just overflow a tiny box.
 * `videoAutoplay`/`videoControls` default to true for the real presentation window; the
 * preview thumbnails pass false for both so a video slide shows a static first frame instead
 * of three extra videos quietly playing at once. `videoMuted` defaults to false (the real
 * presentation window plays media video audio through the room's own sound system) — the
 * Remote Control mirror is the one caller that passes true, to avoid feedback/echo from a
 * phone speaker near the platform (see RemoteMirror.vue's own tap-to-unmute affordance).
 * `transition`, when true, fades across a content change instead of cutting instantly — see
 * displayedContent below. Only PresentationView.vue/WebAudienceView.vue (the actual
 * audience-facing output) pass it; the preview thumbnails and Remote mirror leave it off since
 * an operator watching those wants immediate feedback, not a delayed transition.
 */
const props = withDefaults(
  defineProps<{
    content?: LiveSlideContent
    fixedSize?: { width: number; height: number }
    videoAutoplay?: boolean
    videoControls?: boolean
    videoMuted?: boolean
    transition?: boolean
  }>(),
  { videoAutoplay: true, videoControls: true, videoMuted: false, transition: false },
)

// Every computed/template expression below reads displayedContent, never props.content
// directly — when `transition` is on, it deliberately lags behind the real prop by up to
// FADE_MS while .slide-root fades to invisible, so the actual content swap only ever happens
// once nothing of the old slide is visible (a clean cut hidden inside the fade, never a jump
// mid-fade, and never two videos/background audio tracks briefly overlapping). When
// `transition` is off (the default), it mirrors props.content immediately — identical to this
// component's behavior before transitions existed. See notes/slide-transitions-plan.md.
const FADE_MS = 125
// Bound into <style>'s v-bind() below so the background crossfade's CSS duration can never
// drift out of sync with the JS constant driving everything else.
const fadeDurationCss = `${FADE_MS}ms`
const displayedContent = ref<LiveSlideContent | undefined>(props.content)
const fading = ref(false)
let fadeTimer: ReturnType<typeof setTimeout> | undefined

// A back-to-back repeat of the same song block (e.g. three Choruses in a row) produces a fresh
// LiveSlideContent object with every field identical except `repeatLabel` itself (see
// flattenService.ts's repeat-run handling) — nothing about it actually looks different, so
// fading would just be a pointless flicker. JSON.stringify is fine here (called once per slide
// change, never per frame, on a small object always built the same shape by buildLiveContent),
// and both sides come from that same function, so key order can't drift between calls.
function contentSignature(content: LiveSlideContent | undefined): string {
  if (!content) return ''
  const rest: Partial<LiveSlideContent> = { ...content }
  delete rest.repeatLabel
  return JSON.stringify(rest)
}

watch(
  () => props.content,
  (next) => {
    if (!props.transition) {
      displayedContent.value = next
      return
    }
    if (contentSignature(next) === contentSignature(displayedContent.value)) {
      // Only the repeat counter (if anything) is actually different — update immediately so
      // that still moves, without fading content that never visually changed.
      displayedContent.value = next
      return
    }
    // A change arriving mid-fade (rapid operator clicks) just restarts the wait rather than
    // stacking timers — the intermediate content is never shown either way, only whatever's
    // current once things settle.
    if (fadeTimer) clearTimeout(fadeTimer)
    fading.value = true
    fadeTimer = setTimeout(() => {
      displayedContent.value = next
      fading.value = false
      fadeTimer = undefined
    }, FADE_MS)
  },
)

// Song/scripture/text-slide/slide-ref items — the ones rendered by the plain "slide-text"
// branch below, as opposed to wayfinding/media which have their own distinct designs and
// don't get a header/footer. Matches that branch's v-else-if fallthrough condition exactly.
const isTextSlide = computed(
  () =>
    !!displayedContent.value &&
    !displayedContent.value.backgroundOnly &&
    !displayedContent.value.scene &&
    !displayedContent.value.wayfindingBooks &&
    !displayedContent.value.media,
)

// Song slides override the footer with the song's own collection citation instead of the
// block label (see flattenService.ts's formatSongFooter) — footerText is only ever set (even
// to '', meaning "no collection, hide the footer") for song slides, so undefined here means
// "not a song slide, keep showing subLabel" for every other text-slide type.
const footerDisplayText = computed(() =>
  displayedContent.value?.footerText !== undefined
    ? displayedContent.value.footerText
    : displayedContent.value?.subLabel,
)

// Background Only is a presentation override, not a mutation of the saved scene. Advanced
// slides keep their configured color/image background while temporarily omitting every scene
// element; the other foreground-only slide types naturally fall back to the black canvas.
const renderedScene = computed(() => {
  const scene = displayedContent.value?.scene
  if (!scene || !displayedContent.value?.backgroundOnly) return scene
  return { ...scene, elements: [] }
})

const rootStyle = computed(() => {
  const theme = displayedContent.value?.presentationTheme
  return {
    // Covers the solid-color background case (no theme backgroundMedia): a CSS transition on
    // background-color only ever animates when the color value itself actually changes, so a
    // shared color across an item's slides is naturally left untouched — same "don't fade
    // unless it changes" rule the background media Transition below enforces, for free, with
    // no JS comparison needed here. Always present (not just while `transition` is on) so the
    // duration can never drift out of sync with FADE_MS — harmless when `transition` is off,
    // since these callers never receive a content change with a different backgroundColor
    // faster than the color itself would just cut anyway.
    transition: `background-color ${FADE_MS}ms ease`,
    ...(props.fixedSize
      ? { width: `${props.fixedSize.width}px`, height: `${props.fixedSize.height}px` }
      : {}),
    ...(theme
      ? {
          backgroundColor: theme.backgroundColor,
          color: theme.textColor,
          fontFamily: theme.fontFamily,
          textShadow: presentationTextShadow(theme.textEffect),
        }
      : {}),
  }
})

// The theme styling the header/footer inherit from .slide-root, restated on the labels themselves.
//
// Those two live on different clocks. A label's *text* is transitioned (out-in, keyed on the text),
// but every visual property came from .slide-root and so changed the instant displayedContent
// swapped — mid-fade, while the outgoing label was still on screen. You saw the current slide's
// label abruptly re-render in the *next* slide's font, hold there, and only then change text.
//
// Setting them here instead pins them to the element rather than the ancestor. Vue stops patching
// the outgoing label once it unmounts it, so its inline style freezes at the theme it was built
// with and it fades out looking exactly as it did — the new label arrives already carrying the new
// one. Font is what's visible enough to notice, but colour and text effect would drift the same way
// between two themes that differ in them.
const labelThemeStyle = computed(() => {
  const theme = displayedContent.value?.presentationTheme
  // Matches rootStyle's own condition: with no theme these stay unset and inherit, as before.
  if (!theme) return {}
  return {
    fontFamily: theme.fontFamily,
    color: theme.textColor,
    textShadow: presentationTextShadow(theme.textEffect),
  }
})

// Auto-fit sizing (spec section 1): flattenService already decided *how much content* goes on
// this slide (verse-boundary-safe splitting for scripture, one block per slide for songs — see
// utils/flattenService.ts); this is the real measurement pass, against this component's actual
// pixel size (real window or virtual thumbnail canvas — see fixedSize above), that picks the
// largest font size within content.fontRange that doesn't overflow. Scripture's text is one
// flowing paragraph and just uses the browser's own wrapping (measured via the live element's
// scrollHeight); song blocks set `lineWrap` so each authored line only wraps if it truly
// doesn't fit, preferring a break at a comma/semicolon over an arbitrary word boundary (see
// wrapLineAtPunctuation) — that requires computing the wrapped text ourselves via real canvas
// measurement rather than just reading scrollHeight, since the *choice* of where to break has
// to be made before anything is rendered. Other slide types (plain text-slides) don't set
// fontRange, so they keep the static CSS clamp below untouched.
const rootRef = ref<HTMLElement>()
const measureRef = ref<HTMLElement>()
const headerRef = ref<HTMLElement>()
const footerRef = ref<HTMLElement>()
const wayfindingProgressRef = ref<HTMLElement>()
const fittedFontSizePx = ref<number>()
const displayText = ref('')
let resizeObserver: ResizeObserver | undefined

let measureCtx: CanvasRenderingContext2D | null | undefined
function measureTextWidthPx(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!measureCtx) return text.length * 10 // defensive fallback; a real webview always has 2D canvas support
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

// Builds the same DOM a verse-segments slide's real template (see the v-for above) would
// produce, into the measurement sandbox — so its scrollHeight accounts for each chip's own
// padding/border/line-height the same way the real, visible render does. Only ever touches
// measureEl, never the real .slide-text Vue itself manages (see measureRef's own doc comment).
function renderVerseSegmentsInto(measureEl: HTMLElement, segments: ScriptureTextSegment[]) {
  measureEl.replaceChildren(
    ...segments.map((segment) => {
      if (segment.type !== 'number') return document.createTextNode(segment.value)
      const chip = document.createElement('span')
      chip.className = 'verse-number-chip'
      chip.textContent = segment.value
      return chip
    }),
  )
}

function fitAutoSizedText() {
  const range = displayedContent.value?.fontRange
  const root = rootRef.value
  const measureEl = measureRef.value
  const rawText = displayedContent.value?.text ?? ''
  if (!range || !root || !measureEl) {
    fittedFontSizePx.value = undefined
    displayText.value = rawText
    return
  }
  // Reserves exactly the header/footer's own rendered footprint (if either is showing for this
  // slide), plus a little breathing room — not a flat percentage guess. A flat guess (the
  // previous approach) badly under-reserves on a short container, such as presenting directly on
  // a phone's own screen: the header/footer's font size shrinks proportionally there too (see
  // labelFontSize below) but a fixed percentage doesn't know that, so the centered text would
  // still grow right into their fixed top/bottom insets.
  //
  // Deliberately offsetHeight/getComputedStyle here, never getBoundingClientRect() — the preview
  // thumbnails render this component at a literal full size, then scale the whole thing down via
  // a CSS transform on an ancestor (see this file's own fixedSize doc comment), and
  // getBoundingClientRect() reports coordinates *after* that transform while
  // offsetHeight/getComputedStyle report the true, un-transformed layout size. Mixing the two
  // (as this used to) threw off the thumbnail's own reserved space just enough to sometimes pick
  // a different font size — and thus wrap differently — than the real presentation window
  // showing the exact same slide.
  //
  // Measured off the always-mounted label slots (see the template) rather than the labels
  // themselves. An empty slot has no height, so `occupied` distinguishes "this slide has no such
  // label" from "the label is there" without consulting the refs' existence — which, during a
  // crossfade, says nothing about what is actually on screen.
  const breathingPx = root.clientHeight * 0.04
  const occupied = (slot: HTMLElement | undefined, inset: 'top' | 'bottom'): number => {
    const heightPx = slot?.offsetHeight ?? 0
    if (!slot || heightPx === 0) return breathingPx
    return (parseFloat(getComputedStyle(slot)[inset]) || 0) + heightPx + breathingPx
  }
  const topBoundPx = occupied(headerRef.value, 'top')
  const bottomBoundPx = occupied(footerRef.value, 'bottom')
  const maxHeightPx = Math.max(0, root.clientHeight - topBoundPx - bottomBoundPx)
  // Matches .slide-content's max-width: 90cqw — the sandbox lives outside that container's own
  // box (see .measure-sandbox below), so it needs this set explicitly to measure wrapping the
  // same way the real, visible content would reflow.
  const maxWidthPx = root.clientWidth * 0.9
  measureEl.style.width = `${maxWidthPx}px`
  // The search may go slightly below the configured minimum, but only when it has to.
  //
  // Pagination decides how much text lands on a slide by *estimating* wrapping against an assumed
  // average glyph width (textAutoFit.ts), which cannot know the theme's actual font — a wide face
  // like Montserrat fits noticeably fewer characters per line than the estimate assumes. When that
  // estimate is optimistic, the page arrives here needing more room than the minimum size allows,
  // and clamping at the minimum meant the text simply ran over the header and footer: illegible,
  // and worse than being a little smaller than asked for.
  //
  // Because the search takes the largest size that fits, this floor is only ever reached when the
  // minimum genuinely does not fit — no special case needed. Bounded to 10% below rather than
  // unbounded, since text nobody at the back of the room can read is its own kind of broken; a
  // passage too long even for that still overflows, which is now rare rather than routine.
  const floorPx = Math.floor(range.minPx * 0.9)
  let lo = floorPx
  let hi = Math.floor(range.maxPx)
  let best = lo

  if (displayedContent.value?.lineWrap) {
    const computed = getComputedStyle(measureEl)
    const rawLines = rawText.split('\n')
    const fontAt = (sizePx: number) => `${computed.fontWeight} ${sizePx}px ${computed.fontFamily}`
    // Wraps every authored line (preferring a comma/semicolon break over a word boundary — see
    // wrapLineAtPunctuation) at the given size and returns the resulting rows. A line that
    // already fits comes back unwrapped, so this covers "nothing needs to wrap" and "some lines
    // do" uniformly — a size that requires one extra wrapped row can still beat a smaller size
    // that avoids wrapping altogether, as long as the *total* rendered height still fits. Only
    // ever called with lines already known non-empty by the '' guard below, since an empty
    // string measures as fitting (width 0) and wrapLineAtPunctuation would just return `['']`
    // anyway — the guard exists to skip a wasted measurement, not to change the result.
    const wrapAtSize = (sizePx: number): string[] => {
      const font = fontAt(sizePx)
      return rawLines.flatMap((line) =>
        line ? wrapLineAtPunctuation(line, maxWidthPx, (t) => measureTextWidthPx(t, font)) : [''],
      )
    }
    // Wrapping a line only ever adds rows, never removes them, so a bigger size never produces
    // *fewer* total rows than a smaller one — total rendered height is monotonic in size, so the
    // largest fitting size can still be found with a plain binary search. Height is checked via
    // the real rendered scrollHeight (same technique as the non-lineWrap path below), not an
    // estimated rows × size × line-height — this now runs close to the actual height budget
    // (deliberately using extra wrapped rows to grow the font, where the old algorithm always
    // had slack from avoiding wrapping whenever possible), so a real font's actual line-height/
    // text-shadow bleed no longer has room to drift from an estimate the way it used to. Width
    // still has to be re-checked per *wrapped* row too: wrapLineAtPunctuation gives up and
    // returns an oversized row intact when a line has no break character within budget, rather
    // than ever breaking mid-word — a size where that happens must be rejected even if the
    // height alone would otherwise fit, or that row would render past the slide's edge, clipped
    // by .slide-content's overflow: hidden. As size grows, the pixel budget covers fewer
    // characters, so a give-up that occurs at one size keeps occurring at every larger size too
    // — this stays monotonic, just like the height check.
    const fitsWrapped = (sizePx: number): boolean => {
      const font = fontAt(sizePx)
      const wrapped = wrapAtSize(sizePx)
      if (!wrapped.every((row) => measureTextWidthPx(row, font) <= maxWidthPx)) return false
      measureEl.textContent = wrapped.join('\n')
      measureEl.style.fontSize = `${sizePx}px`
      return measureEl.scrollHeight <= maxHeightPx
    }

    if (fitsWrapped(lo)) {
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (fitsWrapped(mid)) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
    } else {
      // Even the configured minimum doesn't fit once wrapped — shrink below it down to a hard
      // floor instead of forcing range.minPx and overflowing (same reasoning as the non-lineWrap
      // scripture path below: an overlapping, half-illegible slide is worse than a smaller one
      // that's still fully legible and doesn't collide with anything).
      const FLOOR_PX = 12
      let shrinkHi = lo - 1
      let shrinkLo = Math.min(FLOOR_PX, Math.max(1, shrinkHi))
      best = shrinkLo
      while (shrinkLo <= shrinkHi) {
        const mid = Math.floor((shrinkLo + shrinkHi) / 2)
        if (fitsWrapped(mid)) {
          best = mid
          shrinkLo = mid + 1
        } else {
          shrinkHi = mid - 1
        }
      }
    }
    measureEl.style.fontSize = `${best}px`
    displayText.value = wrapAtSize(best).join('\n')
  } else {
    // The binary search below only ever probes the off-screen sandbox (see measureRef's own doc
    // comment) — the real, visible .slide-text is never touched here at all, only afterward via
    // fittedFontSizePx/displayText (plain text) or displayedContent.verseSegments directly
    // (chips), both already Vue-reactive and rendered through the template.
    const verseSegments = displayedContent.value?.verseSegments
    if (verseSegments) {
      renderVerseSegmentsInto(measureEl, verseSegments)
    } else {
      measureEl.textContent = rawText
    }
    measureEl.style.fontSize = `${lo}px`
    if (measureEl.scrollHeight <= maxHeightPx) {
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        measureEl.style.fontSize = `${mid}px`
        if (measureEl.scrollHeight <= maxHeightPx) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
    } else {
      // Even the configured minimum doesn't fit this container (e.g. several verses of scripture
      // on a phone held in landscape, where the available height is quite short) — search below
      // it down to a hard floor instead of forcing range.minPx and overflowing into the
      // header/footer labels. An overlapping, half-illegible slide is worse than a smaller one
      // that's still fully legible and doesn't collide with anything.
      const FLOOR_PX = 12
      let shrinkHi = lo - 1
      let shrinkLo = Math.min(FLOOR_PX, Math.max(1, shrinkHi))
      best = shrinkLo
      while (shrinkLo <= shrinkHi) {
        const mid = Math.floor((shrinkLo + shrinkHi) / 2)
        measureEl.style.fontSize = `${mid}px`
        if (measureEl.scrollHeight <= maxHeightPx) {
          best = mid
          shrinkLo = mid + 1
        } else {
          shrinkHi = mid - 1
        }
      }
    }
    if (!verseSegments) displayText.value = rawText
  }
  fittedFontSizePx.value = best
}

watch(
  () =>
    [
      displayedContent.value?.text,
      displayedContent.value?.fontRange,
      displayedContent.value?.lineWrap,
      displayedContent.value?.itemLabel,
      footerDisplayText.value,
    ] as const,
  () => nextTick(fitAutoSizedText),
  { flush: 'post' },
)

// A freshly opened presentation window hasn't necessarily finished loading the slide's actual
// font yet (each @fontsource-variable family is only fetched/parsed once something first
// requests it — see main.ts's imports) — both the canvas measurement (lineWrap path) and
// scrollHeight (non-lineWrap path) above silently measure against the browser's fallback font
// until the real one swaps in, which can pick a size that's wrong for the real font's actual
// glyph metrics. Nothing else here re-runs the fit once that swap happens on its own (the
// ResizeObserver only fires on the *root's* own box size, not a same-size text reflow), so
// without this, the first slide of a fresh presentation window can render mis-sized until
// something else (the next slide, or navigating back to this one) happens to re-trigger
// fitAutoSizedText for an unrelated reason.
function onFontsLoadingDone() {
  fitAutoSizedText()
}

onMounted(() => {
  if (rootRef.value) {
    measureWayfindingAvailableHeight()
    resizeObserver = new ResizeObserver(() => {
      fitAutoSizedText()
      measureWayfindingAvailableHeight()
    })
    resizeObserver.observe(rootRef.value)
    // The label slots are watched too, so the fit re-runs whenever the space they occupy actually
    // changes rather than only when the content does. The slots make the common case (a label
    // whose text changes) measure correctly on the first pass, but a label that appears or
    // disappears entirely settles a crossfade later, and the fit has no other way to hear about
    // it. Sizing text is the only thing this recomputes, and that never feeds back into a slot's
    // own height, so there is no loop to guard against.
    if (headerRef.value) resizeObserver.observe(headerRef.value)
    if (footerRef.value) resizeObserver.observe(footerRef.value)
  }
  document.fonts.addEventListener('loadingdone', onFontsLoadingDone)
})
onUnmounted(() => {
  resizeObserver?.disconnect()
  document.fonts.removeEventListener('loadingdone', onFontsLoadingDone)
  if (fadeTimer) clearTimeout(fadeTimer)
})

// Wayfinding (reference-only scripture, spec section 1): books further from the current one
// shrink and fade, one fade level per book regardless of length — mirrors flipping through a
// physical Bible and seeing nearby book names. Size is linearly interpolated by distance
// between the configured max (Settings > Font Sizes; approached by the nearest book, used
// directly by the reference itself) and min (the farthest book actually shown) — using
// Math.abs on every distance here, not just the current one, since the farthest book present
// isn't always at the full configured radius (e.g. Revelation has no books after it).
// Settings > Font Sizes' header/footer values are chosen against a normal-size (~16:9)
// presentation display and used verbatim there — both cqh and cqw candidates resolve well above
// a typical configured 40-60px at that aspect ratio, so the clamp's max branch wins. Capping
// proportionally by *both* container height and width (the smaller of the two candidates) keeps
// the label from dominating a container that's short (a phone's own screen), narrow (a resized
// desktop window), or both — a height-only cap still let a long label like a hymnal citation
// render at full configured size and wrap across a narrow width, each wrapped line still huge.
function labelFontSize(configuredPx: number | undefined): string {
  return `clamp(10px, min(8cqh, 5cqw), ${configuredPx ?? 48}px)`
}

// A CSS clamp() proportional to container height alone (an earlier version of this) couldn't
// actually guarantee the whole stack fits: it capped each row's *own* size but had no idea how
// many rows there were, how much the fixed gap/margin between them added up to, or that the
// progress bar below needs its own real space — so a normal 2-book-radius stack (5 rows) could
// still overflow (and run into the progress bar) well short of a phone-size window. This measures
// the *real* total height the stack would need at its natural configured sizes, against the
// actual space available above the progress bar (wayfindingAvailableHeightPx, kept live by the
// ResizeObserver below, same idea as the header/footer footprint measurement above), and scales
// every row — font sizes and the gaps/margin between them — down by the same factor if that
// total doesn't fit. At a normal presentation size this natural total is well within budget, so
// scale lands at 1 and nothing changes from the literal configured px.
const wayfindingAvailableHeightPx = ref(0)
const WAYFINDING_LINE_HEIGHT_RATIO = 1.2
const WAYFINDING_GAP_PX = 10
const WAYFINDING_REFERENCE_MARGIN_PX = 18

function measureWayfindingAvailableHeight() {
  const root = rootRef.value
  if (!root) {
    wayfindingAvailableHeightPx.value = 0
    return
  }
  // Same offsetHeight/getComputedStyle reasoning as fitAutoSizedText's topBoundPx/bottomBoundPx
  // above — getBoundingClientRect() would report post-transform coordinates in the (literal
  // full size, then CSS-transform-scaled) preview thumbnails, throwing this off there specifically.
  const breathingPx = root.clientHeight * 0.05
  const bottomReservedPx = wayfindingProgressRef.value
    ? (parseFloat(getComputedStyle(wayfindingProgressRef.value).bottom) || 0) +
      wayfindingProgressRef.value.offsetHeight +
      breathingPx
    : breathingPx
  wayfindingAvailableHeightPx.value = Math.max(
    0,
    root.clientHeight - breathingPx - bottomReservedPx,
  )
}

function wayfindingNaturalBookSize(distance: number): number {
  const maxPx = displayedContent.value?.wayfindingMaxFontSizePx ?? 150
  const minPx = displayedContent.value?.wayfindingMinFontSizePx ?? 56
  const radius = Math.max(
    1,
    ...(displayedContent.value?.wayfindingBooks ?? []).map((b) => Math.abs(b.distance)),
  )
  const t = Math.abs(distance) / radius
  return maxPx + (minPx - maxPx) * t
}

const wayfindingScale = computed(() => {
  const books = displayedContent.value?.wayfindingBooks
  if (!books || wayfindingAvailableHeightPx.value === 0) return 1
  const maxPx = displayedContent.value?.wayfindingMaxFontSizePx ?? 150
  const rowSizes = [...books.map((b) => wayfindingNaturalBookSize(b.distance)), maxPx]
  const naturalTotalPx =
    rowSizes.reduce((sum, px) => sum + px * WAYFINDING_LINE_HEIGHT_RATIO, 0) +
    (rowSizes.length - 1) * WAYFINDING_GAP_PX +
    2 * WAYFINDING_REFERENCE_MARGIN_PX
  return Math.min(1, wayfindingAvailableHeightPx.value / naturalTotalPx)
})

function wayfindingFontSize(configuredPx: number): string {
  return `${Math.max(10, configuredPx * wayfindingScale.value)}px`
}

function wayfindingSpacingSize(configuredPx: number): string {
  return `${Math.max(2, configuredPx * wayfindingScale.value)}px`
}

function bookStyle(distance: number) {
  const level = Math.abs(distance)
  const opacities = [0.55, 0.3]
  return {
    fontSize: wayfindingFontSize(wayfindingNaturalBookSize(distance)),
    opacity: opacities[level - 1] ?? opacities[opacities.length - 1],
  }
}

// The wayfinding progress bar's four segment widths (as 0-1 fractions of the whole bar) — Old
// Testament and New Testament each split into a "read so far" (solid) and "remaining" (dim)
// portion, sized by OLD_TESTAMENT_FRACTION and the current reference's overall bibleProgress.
// Always sums to exactly 1.
const progressSegments = computed(() => {
  if (displayedContent.value?.backgroundOnly) return undefined
  const bibleProgress = displayedContent.value?.bibleProgress
  if (bibleProgress === undefined) return undefined
  return {
    otFilled: Math.min(bibleProgress, OLD_TESTAMENT_FRACTION),
    otUnfilled: Math.max(0, OLD_TESTAMENT_FRACTION - bibleProgress),
    ntFilled: Math.max(0, Math.min(bibleProgress, 1) - OLD_TESTAMENT_FRACTION),
    ntUnfilled: Math.max(0, 1 - Math.max(bibleProgress, OLD_TESTAMENT_FRACTION)),
  }
})
</script>

<template>
  <div ref="rootRef" class="slide-root" :style="rootStyle">
    <!-- Its own, independent fade — keyed by the background's own identity (kind+url), so
         Vue only actually triggers enter/leave when the background itself changes; navigating
         between other slides of the same item that share one background leaves this element
         untouched (not even patched), never dimming. No `mode` (unlike displayedContent's own
         swap-at-the-trough timing below): the old and new background overlap and cross-dissolve
         directly into each other rather than fading through black/the theme color first —
         safe to let them briefly overlap because a theme background video is always `muted`
         below, so there's no audio to double up the way an unmuted foreground media video
         could. Disabled (no name = no matching CSS = an instant cut) whenever `transition` is
         off, matching every other caller of this component. -->
    <Transition :name="transition ? 'content-crossfade' : ''">
      <img
        v-if="displayedContent?.presentationTheme?.backgroundMedia?.kind === 'image'"
        :key="`image:${displayedContent.presentationTheme.backgroundMedia.url}`"
        :src="displayedContent.presentationTheme.backgroundMedia.url"
        class="theme-background"
        :style="{ objectFit: displayedContent.presentationTheme.backgroundMedia.fit }"
        alt=""
      />
      <video
        v-else-if="displayedContent?.presentationTheme?.backgroundMedia?.kind === 'video'"
        :key="`video:${displayedContent.presentationTheme.backgroundMedia.url}`"
        :src="displayedContent.presentationTheme.backgroundMedia.url"
        class="theme-background"
        :style="{ objectFit: displayedContent.presentationTheme.backgroundMedia.fit }"
        :autoplay="videoAutoplay"
        loop
        muted
        playsinline
      />
    </Transition>
    <!-- Everything but the background above lives in here so the fade driven by `fading`
         (see displayedContent in script) only ever dims the foreground — the background keeps
         playing/showing underneath untouched unless its own Transition above decides it
         actually changed. -->
    <div class="slide-foreground" :class="{ 'slide-foreground--fading': fading }">
      <SlideSceneRenderer
        v-if="renderedScene"
        :scene="renderedScene"
        :service-date-time="displayedContent?.serviceDateTime"
      />
      <div
        v-else-if="displayedContent?.wayfindingBooks && !displayedContent.backgroundOnly"
        class="wayfinding-content"
        :style="{ gap: wayfindingSpacingSize(10) }"
      >
        <div
          v-for="book in displayedContent.wayfindingBooks.filter((b) => b.distance < 0)"
          :key="book.name"
          class="wayfinding-book"
          :style="bookStyle(book.distance)"
        >
          {{ book.name }}
        </div>
        <div
          class="wayfinding-reference"
          :style="{
            fontSize: wayfindingFontSize(displayedContent.wayfindingMaxFontSizePx ?? 150),
            margin: `${wayfindingSpacingSize(18)} 0`,
          }"
        >
          {{ displayedContent.itemLabel }}
        </div>
        <div
          v-for="book in displayedContent.wayfindingBooks.filter((b) => b.distance > 0)"
          :key="book.name"
          class="wayfinding-book"
          :style="bookStyle(book.distance)"
        >
          {{ book.name }}
        </div>
      </div>
      <div
        v-if="progressSegments"
        ref="wayfindingProgressRef"
        class="wayfinding-progress-container"
      >
        <div class="wayfinding-progress-labels">
          <span class="wayfinding-progress-label" style="color: #d4af37">Old Testament</span>
          <span class="wayfinding-progress-label" style="color: #4fa8d8">New Testament</span>
        </div>
        <!-- A sibling of both the labels and the bar-wrapper (not nested in either) so its
             height can span from near the label text down through the bar — its left position
             is still a percentage of the same width as the bar below, since neither it nor the
             bar-wrapper add any side padding/margin. -->
        <div
          class="wayfinding-progress-boundary"
          :style="{ left: `${OLD_TESTAMENT_FRACTION * 100}%` }"
        />
        <div class="wayfinding-progress-bar-wrapper">
          <div class="wayfinding-progress">
            <div
              v-for="(segment, index) in [
                { width: progressSegments.otFilled, color: '#d4af37', opacity: 1 },
                { width: progressSegments.otUnfilled, color: '#d4af37', opacity: 0.25 },
                { width: progressSegments.ntFilled, color: '#4fa8d8', opacity: 1 },
                { width: progressSegments.ntUnfilled, color: '#4fa8d8', opacity: 0.25 },
              ]"
              :key="index"
              :style="{
                flexBasis: `${segment.width * 100}%`,
                background: segment.color,
                opacity: segment.opacity,
              }"
            />
          </div>
          <!-- A sibling of (not nested in) .wayfinding-progress — that bar clips to a rounded
               pill via overflow:hidden, which would cut off this extending past its height. Its
               own vertical centering is relative to this wrapper (the bar's own box), not the
               taller .wayfinding-progress-container above, so it centers on the bar itself. -->
          <div
            class="wayfinding-progress-marker"
            :style="{ left: `${(displayedContent?.bibleProgress ?? 0) * 100}%` }"
          />
        </div>
      </div>
      <img
        v-else-if="displayedContent?.media?.kind === 'image'"
        :key="displayedContent.media.url"
        :src="displayedContent.media.url"
        class="media-fill"
        :style="{ objectFit: displayedContent.media.fit }"
        alt=""
      />
      <video
        v-else-if="displayedContent?.media?.kind === 'video'"
        :key="displayedContent.media.url"
        :src="displayedContent.media.url"
        class="media-fill"
        :style="{ objectFit: displayedContent.media.fit }"
        :autoplay="videoAutoplay"
        :controls="videoControls"
        :muted="videoMuted"
      />
      <div
        v-else-if="displayedContent?.outlineTitle && !displayedContent.backgroundOnly"
        class="slide-content outline-content"
      >
        <div class="outline-title">{{ displayedContent.outlineTitle }}</div>
        <div v-if="displayedContent.text" class="outline-details">{{ displayedContent.text }}</div>
      </div>
      <div
        v-else-if="
          displayedContent &&
          !displayedContent.backgroundOnly &&
          !displayedContent.scene &&
          !displayedContent.wayfindingBooks
        "
        class="slide-content"
      >
        <div
          class="slide-text"
          :style="{
            ...(displayedContent.fontRange
              ? { fontSize: `${fittedFontSizePx ?? displayedContent.fontRange.maxPx}px` }
              : {}),
            // Song lines must never wrap except where we've explicitly inserted a break (see
            // wrapLineAtPunctuation) — `pre-line` still lets the browser wrap a preserved line
            // that doesn't fit, which silently undid the comma/semicolon-only rule for any line
            // with no punctuation to break at. Scripture keeps normal paragraph wrapping.
            ...(displayedContent.lineWrap ? { whiteSpace: 'pre' } : {}),
          }"
        >
          <template v-if="displayedContent.verseSegments">
            <template
              v-for="(segment, segmentIndex) in displayedContent.verseSegments"
              :key="segmentIndex"
            >
              <span v-if="segment.type === 'number'" class="verse-number-chip">{{
                segment.value
              }}</span>
              <template v-else>{{ segment.value }}</template>
            </template>
          </template>
          <template v-else>{{ displayText }}</template>
        </div>
        <!-- Off-screen, never touched by Vue's own template/reactivity — fitAutoSizedText's
             binary search does its raw textContent/fontSize probing entirely on this element
             instead of the real .slide-text above (see measureRef's own comment there for why:
             writing directly into a node Vue also manages via v-if/v-for corrupts Vue's vnode
             tracking for it). Shares the real element's classes so font-size/line-height/
             white-space rules match exactly. -->
        <div
          ref="measureRef"
          class="slide-text measure-sandbox"
          aria-hidden="true"
          :style="{ ...(displayedContent.lineWrap ? { whiteSpace: 'pre' } : {}) }"
        />
      </div>

      <div v-if="isTextSlide && displayedContent?.repeatLabel" class="slide-repeat-label">
        {{ displayedContent.repeatLabel }}
      </div>
    </div>
    <!-- Header/footer live outside .slide-foreground, each with their own independent
         crossfade keyed by their own text — same reasoning as the background above: a song's
         header (title) and footer (collection citation) are typically identical across every
         one of its slides, and nesting them inside .slide-foreground would still visually dim
         them on every slide change (an ancestor's opacity affects all descendants regardless of
         whether their own content changed), even though the label itself never moved.
         `mode="out-in"`, unlike the background's simultaneous cross-dissolve: two overlapping
         image layers reads as a smooth dissolve, but two overlapping strings of text reads as
         garbled, so the old label fully clears before the new one fades in. Fixed position,
         fixed (configurable) size — unlike the auto-fit main text above, these never move or
         resize as that text shrinks/grows. Only for the plain text slide above; wayfinding/media
         have their own distinct designs. -->
    <!-- The measured refs live on these always-mounted slots, never on the labels themselves.
         `mode="out-in"` unmounts the outgoing label's vnode immediately and only defers its DOM
         removal until the fade ends — and Vue nulls a template ref at unmount, not at removal. So
         a ref on the label itself reads null for the whole crossfade, while the label is still
         plainly visible on screen. fitAutoSizedText runs inside exactly that window, and with both
         refs null it reserved only breathing room instead of the labels' real footprint: ~25% too
         much height at 1080p, which it spent on a font size that then overran them. Nothing
         re-ran the fit once the new labels mounted.

         Whether it happened turned on whether the label *text* changed — that being what changes
         the key — so moving to the first slide of an item broke and moving between slides within
         one item did not. The slots stay mounted through the swap and always contain whichever
         label is currently on screen, so their height is right at every moment of it. -->
    <div ref="headerRef" class="slide-label-slot slide-header-slot">
      <Transition :name="transition ? 'content-crossfade' : ''" mode="out-in">
        <div
          v-if="isTextSlide && displayedContent?.itemLabel"
          :key="displayedContent.itemLabel"
          class="slide-header"
          :style="{
            ...labelThemeStyle,
            fontSize: labelFontSize(displayedContent?.headerFontSizePx),
          }"
        >
          {{ displayedContent.itemLabel }}
        </div>
      </Transition>
    </div>
    <div ref="footerRef" class="slide-label-slot slide-footer-slot">
      <Transition :name="transition ? 'content-crossfade' : ''" mode="out-in">
        <div
          v-if="isTextSlide && footerDisplayText"
          :key="footerDisplayText"
          class="slide-footer"
          :style="{
            ...labelThemeStyle,
            fontSize: labelFontSize(displayedContent?.footerFontSizePx),
          }"
        >
          {{ footerDisplayText }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.slide-root {
  width: 100vw;
  height: 100vh;
  /* Lets clamp()'s cqw values below resolve against *this component's own* box rather than the
     real browser viewport — needed so the exact same CSS looks right whether this is the real
     full-window presentation or a small thumbnail rendered at a fixed virtual size (see
     fixedSize above): in the latter case the root's actual on-screen box is much smaller than
     its own literal width/height, but vw/vh would still mean "real browser viewport", not this
     box, giving wildly wrong proportions inside the miniature. */
  container-type: size;
  position: relative;
  background: #000;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* This is a live rendering, not a document — selecting its text serves no purpose and, on a
     touch device, a long-press-to-select on the audience window pops up the phone's own
     dictionary/"Look Up" definition bubble over the slide. -webkit-touch-callout also suppresses
     iOS's press-and-hold callout menu, which would otherwise still offer to look up/share the
     text even with selection itself disabled. */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
/* Everything except the background media (see the Transition-wrapped img/video above it in the
   template) — sized/centered exactly like .slide-root used to lay out its direct children
   before this wrapper existed, so nothing inside had to change its own sizing rules. */
.slide-foreground {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Without this, toggling the --fading class below just snaps opacity between 1 and 0 with
     nothing to animate across — always present (not just while `transition` is on) so it can
     never drift out of sync with FADE_MS; harmless when `transition` is off since --fading is
     never applied there. */
  transition: opacity v-bind(fadeDurationCss) ease;
}
/* Only ever toggled on when the `transition` prop is set (see displayedContent/fading in
   script) — the operator preview thumbnails and Remote mirror never apply this class, so they
   stay an instant cut exactly as before transitions existed. Scoped to the foreground only —
   the background media above fades solely via its own Transition, keyed off its own identity,
   so a background shared across an item's slides is never dimmed just because the text on top
   of it changed. */
.slide-foreground--fading {
  opacity: 0;
}
/* Shared by every independently-keyed Transition in the template above (background media,
   header, footer) — each only actually triggers when its own identity (background's kind+url,
   header/footer's own text) changes, never on a same-content slide change within an item. */
.content-crossfade-enter-active,
.content-crossfade-leave-active {
  transition: opacity v-bind(fadeDurationCss) ease;
}
.content-crossfade-enter-from,
.content-crossfade-leave-to {
  opacity: 0;
}
.slide-content {
  position: relative;
  z-index: 1;
  max-width: 90cqw;
  text-align: center;
  /* A flex item's automatic min-width defaults to its content's natural size, which silently
     overrides max-width for unwrappable content (white-space: pre song lines, or any single
     word wider than the box) — the content would push this box past 90cqw and off the right
     edge instead of respecting the cap. Per spec, giving the item its own overflow (anything
     but visible) resets that automatic minimum to 0, so max-width is actually honored; any
     text still too wide to fit is clipped here instead of bleeding past the container. */
  overflow: hidden;
}
.theme-background {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  height: 100%;
}
.slide-label {
  font-size: clamp(14px, 2cqw, 28px);
  opacity: 0.6;
  margin-bottom: 24px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
/* The positioning lives on the slot rather than the label, so fitAutoSizedText can read the inset
   and the occupied height off one element that is always there (see the template). Empty when the
   slide has no such label — zero height, nothing painted — which is what lets the measurement tell
   "no label" from "label mid-crossfade" by height alone. */
.slide-label-slot {
  position: absolute;
  z-index: 1;
  left: 0;
  right: 0;
  /* Out of flow and only ever holding centered text; without this an empty slot would still sit
     over the slide and swallow clicks meant for the content beneath it. */
  pointer-events: none;
}
.slide-header-slot {
  top: clamp(8px, 4cqh, 40px);
}
.slide-footer-slot {
  bottom: clamp(8px, 4cqh, 40px);
}
.slide-header,
.slide-footer {
  max-width: 90cqw;
  margin: 0 auto;
  text-align: center;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.slide-repeat-label {
  position: absolute;
  z-index: 1;
  right: 40px;
  bottom: 40px;
  font-size: clamp(16px, 3cqw, 32px);
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}
.slide-text {
  font-size: clamp(28px, 5cqw, 72px);
  font-weight: 600;
  line-height: 1.3;
  white-space: pre-line;
}
/* A verse-number chip's own border/padding, plus its vertical-align lift above the baseline,
   render taller than a plain glyph and can rise above .slide-text's own top edge — content
   rendered above an element's top edge is *never* reflected in its scrollHeight (only overflow
   below/right of the origin is), so without this reserved space, fitAutoSizedText's binary
   search (which relies entirely on scrollHeight to decide what fits) stays blind to a chip
   poking up into the header above, and picks a font size that visibly does. Matches on any
   .slide-text containing a chip (real or the off-screen measurement sandbox alike, so the
   search sees the same reserved space it'll actually render with) rather than being conditional
   in JS, so there's only one place this number needs to stay in sync with the chip's own sizing. */
.slide-text:has(.verse-number-chip) {
  padding-top: 0.4em;
}
/* fitAutoSizedText's off-screen measurement scratchpad (see measureRef's own doc comment in the
   template) — shares .slide-text's font-size/line-height/white-space rules exactly, but never
   visible and never part of normal layout, so probing it with raw textContent/fontSize writes
   can't affect (or conflict with) anything Vue itself renders. */
.measure-sandbox {
  position: fixed;
  top: -9999px;
  left: -9999px;
  visibility: hidden;
  pointer-events: none;
}
/* Scripture verse numbers (displayedContent.verseSegments) — a fixed-shape marker rather than a
   plain smaller/superscript numeral, so it stays legible at any body size the auto-fit search
   picks (a proportionally-shrunk plain numeral can all but vanish once the body text itself is
   small). All sizing is in `em`, scaled off .slide-text's own current font-size — that's what
   lets fitAutoSizedText's binary search just change .slide-text's font-size per candidate and
   have this chip resize right along with it, the same as any other descendant text would.
   Border/background/blur mirror .wayfinding-progress-container::before's own contrast-panel
   treatment below, for one consistent "readable over any photo" visual language on this slide. */
.verse-number-chip {
  display: inline-block;
  margin-right: 0.3em;
  padding: 0.05em 0.4em;
  font-size: 0.55em;
  font-weight: 700;
  vertical-align: 0.3em;
  line-height: 1.4;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(7, 11, 17, 0.46);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(3px);
  /* Overrides the theme's own text-shadow (inherited from the slide root by default) — same
     reasoning as .wayfinding-progress-labels: this already has its own dedicated contrast panel
     behind it, so the theme's outline/shadow effect was never meant to reach it too. */
  text-shadow: none;
}
.outline-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
}
.outline-title {
  font-size: clamp(36px, 7cqw, 96px);
  font-weight: 700;
  line-height: 1.2;
  white-space: pre-line;
}
.outline-details {
  font-size: clamp(20px, 3.5cqw, 48px);
  font-weight: 500;
  line-height: 1.35;
  white-space: pre-line;
}
.media-fill {
  width: 100%;
  height: 100%;
}
.wayfinding-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* gap set inline (see wayfindingSpacingSize) — responsive to container height and row count */
  max-width: 90cqw;
}
.wayfinding-book {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.wayfinding-reference {
  font-weight: 700;
  /* margin set inline (see wayfindingSpacingSize) — responsive to container height and row count */
  text-align: center;
  max-width: 90cqw;
}
.wayfinding-progress-container {
  isolation: isolate;
  position: absolute;
  z-index: 1;
  left: 50%;
  bottom: clamp(24px, 5cqh, 56px);
  transform: translateX(-50%);
  width: 85cqw;
}
/* A contrast panel behind the complete wayfinding indicator keeps its labels and bar readable
   over both light photography and dark theme backgrounds. This is a pseudo-element rather
   than padding on the container: percentage positions for the Testament boundary and current
   reference marker must remain relative to exactly the same width as the progress bar. */
.wayfinding-progress-container::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: calc(clamp(10px, 1.6cqw, 24px) * -1);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: clamp(12px, 1.4cqw, 22px);
  background: rgba(7, 11, 17, 0.46);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(3px);
}
.wayfinding-progress-labels {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: clamp(18px, 2.6cqw, 34px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  /* Overrides the theme's own text-shadow (set on the slide root, see rootStyle above, and
     inherited by every descendant by default) — these labels already have their own fixed,
     theme-independent gold/blue colors and a dedicated contrast panel behind the whole
     indicator (.wayfinding-progress-container::before) specifically so they stay readable
     regardless of theme or background; the theme's outline/shadow effect was never meant to
     reach them. */
  text-shadow: none;
}
.wayfinding-progress-bar-wrapper {
  position: relative;
}
.wayfinding-progress {
  display: flex;
  width: 100%;
  height: clamp(10px, 1.2cqw, 20px);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
/* Marks the Old/New Testament boundary regardless of fill state — without this, a filled and
   unfilled segment of the *same* color (just different opacity) don't read as a clear split.
   Spans from near the top of the "Old Testament"/"New Testament" labels down through (and
   slightly past) the bar, so it reads as a divider for the whole labeled block, not just the
   bar's own edge — a direct child of .wayfinding-progress-container (a sibling of the labels
   and the bar-wrapper), not nested in .wayfinding-progress, which clips its own contents to a
   rounded pill and would otherwise cut this off. z-index sits above the bar (0) but below the
   position marker (2), so it's visible over the bar's fill without covering the marker. */
.wayfinding-progress-boundary {
  position: absolute;
  z-index: 1;
  top: 6px;
  bottom: -6px;
  width: 2px;
  background: rgba(255, 255, 255, 0.8);
}
/* "You are here" — the current reference's exact position. A circle, not a line, and a
   distinct accent color from both the boundary divider and the gold/blue testament colors, so
   it can't be confused with either even when a reference falls right at the Old/New Testament
   split. Highest z-index of the three layers, so it's never covered by the boundary line. */
.wayfinding-progress-marker {
  position: absolute;
  z-index: 2;
  top: 50%;
  /* Deliberately bigger than the bar's own clamp(10px, 1.2cqw, 20px) at every size (both the
     min and max here exceed the bar's), not just equal to its max — a previous version used a
     flat 20px, which coincidentally matched the bar's own max and so never looked "bigger".
     translate(-50%, -50%), not a fixed negative margin, keeps it centered regardless of which
     end of the clamp actually resolves. */
  width: clamp(18px, 1.8cqw, 30px);
  height: clamp(18px, 1.8cqw, 30px);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: #ff453a;
  border: 2px solid #fff;
  box-shadow: 0 0 8px rgba(255, 69, 58, 0.8);
}
</style>
