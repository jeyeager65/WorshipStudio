<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { wrapLineAtPunctuation } from '@/utils/textAutoFit'
import { OLD_TESTAMENT_FRACTION } from '@/utils/scriptureReference'
import { presentationTextShadow } from '@/utils/presentationTextEffect'
import type { LiveSlideContent } from '@/adapters/types'
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
const textRef = ref<HTMLElement>()
const headerRef = ref<HTMLElement>()
const footerRef = ref<HTMLElement>()
const fittedFontSizePx = ref<number>()
const displayText = ref('')
let resizeObserver: ResizeObserver | undefined

// Matches .slide-text's line-height below — used to convert a wrapped line count into an
// estimated pixel height for the song/lineWrap path's candidate-size search.
const LINE_HEIGHT_RATIO = 1.3

let measureCtx: CanvasRenderingContext2D | null | undefined
function measureTextWidthPx(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!measureCtx) return text.length * 10 // defensive fallback; a real webview always has 2D canvas support
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

function fitAutoSizedText() {
  const range = displayedContent.value?.fontRange
  const root = rootRef.value
  const text = textRef.value
  const rawText = displayedContent.value?.text ?? ''
  if (!range || !root || !text) {
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
  const rootRect = root.getBoundingClientRect()
  const breathingPx = root.clientHeight * 0.04
  const topBoundPx = headerRef.value
    ? headerRef.value.getBoundingClientRect().bottom - rootRect.top + breathingPx
    : breathingPx
  const bottomBoundPx = footerRef.value
    ? rootRect.bottom - footerRef.value.getBoundingClientRect().top + breathingPx
    : breathingPx
  const maxHeightPx = Math.max(0, root.clientHeight - topBoundPx - bottomBoundPx)
  let lo = Math.floor(range.minPx)
  let hi = Math.floor(range.maxPx)
  let best = lo

  if (displayedContent.value?.lineWrap) {
    const maxWidthPx = root.clientWidth * 0.9 // matches .slide-content's max-width: 90cqw
    const computed = getComputedStyle(text)
    const rawLines = rawText.split('\n')
    const fontAt = (sizePx: number) => `${computed.fontWeight} ${sizePx}px ${computed.fontFamily}`
    // Wrapping only ever helps a line that's too *wide* — it never helps the block fit
    // vertically (a wrap adds a row, making the block taller, never shorter) — so a bigger
    // size that "still fits" the height budget by wrapping a line is never actually preferred
    // over a slightly smaller size that avoids wrapping altogether. This checks whether every
    // line fits on its own row, unwrapped, at a given size.
    const fitsUnwrapped = (sizePx: number): boolean => {
      if (rawLines.length * sizePx * LINE_HEIGHT_RATIO > maxHeightPx) return false
      const font = fontAt(sizePx)
      return rawLines.every((line) => measureTextWidthPx(line, font) <= maxWidthPx)
    }
    if (fitsUnwrapped(lo)) {
      // Maximize size within "no line needs to wrap at all".
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        if (fitsUnwrapped(mid)) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      text.style.fontSize = `${best}px`
      displayText.value = rawLines.join('\n')
    } else {
      // Not even the minimum avoids wrapping every line — use the minimum and wrap only the
      // line(s) that don't fit, preferring a comma/semicolon break (see wrapLineAtPunctuation;
      // never a plain word boundary, even if that leaves an unbreakable line overflowing).
      best = lo
      const font = fontAt(best)
      const wrapped = rawLines.flatMap((line) =>
        line ? wrapLineAtPunctuation(line, maxWidthPx, (t) => measureTextWidthPx(t, font)) : [''],
      )
      text.style.fontSize = `${best}px`
      displayText.value = wrapped.join('\n')
    }
  } else {
    // Vue's reactive update to displayText only patches the DOM on its next tick, not
    // synchronously here — measuring scrollHeight immediately after just setting the ref would
    // read the *previous* slide's leftover text, picking the wrong size for the new content.
    // Writing textContent directly makes the measurement see the real, current text right now.
    text.textContent = rawText
    text.style.fontSize = `${lo}px`
    if (text.scrollHeight <= maxHeightPx) {
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        text.style.fontSize = `${mid}px`
        if (text.scrollHeight <= maxHeightPx) {
          best = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
    }
    text.style.fontSize = `${best}px`
    displayText.value = rawText
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
    resizeObserver = new ResizeObserver(() => fitAutoSizedText())
    resizeObserver.observe(rootRef.value)
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
// Settings > Font Sizes' header/footer values are chosen against a normal-size presentation
// display and used verbatim there (8cqh resolves well above a typical configured 40-60px at
// that size, so the clamp's max branch wins). Capping proportionally by container height keeps
// them from dominating a much shorter container instead — e.g. presenting directly on a phone's
// own screen, where the configured px would otherwise be a much bigger fraction of the height.
function labelFontSize(configuredPx: number | undefined): string {
  return `clamp(10px, 8cqh, ${configuredPx ?? 48}px)`
}

function bookStyle(distance: number) {
  const level = Math.abs(distance)
  const maxPx = displayedContent.value?.wayfindingMaxFontSizePx ?? 150
  const minPx = displayedContent.value?.wayfindingMinFontSizePx ?? 56
  const radius = Math.max(
    1,
    ...(displayedContent.value?.wayfindingBooks ?? []).map((b) => Math.abs(b.distance)),
  )
  const t = level / radius
  const opacities = [0.55, 0.3]
  return {
    fontSize: `${maxPx + (minPx - maxPx) * t}px`,
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
          :style="{ fontSize: `${displayedContent.wayfindingMaxFontSizePx ?? 150}px` }"
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
      <div v-if="progressSegments" class="wayfinding-progress-container">
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
          ref="textRef"
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
          {{ displayText }}
        </div>
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
    <Transition :name="transition ? 'content-crossfade' : ''" mode="out-in">
      <div
        v-if="isTextSlide && displayedContent?.itemLabel"
        ref="headerRef"
        :key="displayedContent.itemLabel"
        class="slide-header"
        :style="{ fontSize: labelFontSize(displayedContent?.headerFontSizePx) }"
      >
        {{ displayedContent.itemLabel }}
      </div>
    </Transition>
    <Transition :name="transition ? 'content-crossfade' : ''" mode="out-in">
      <div
        v-if="isTextSlide && footerDisplayText"
        ref="footerRef"
        :key="footerDisplayText"
        class="slide-footer"
        :style="{ fontSize: labelFontSize(displayedContent?.footerFontSizePx) }"
      >
        {{ footerDisplayText }}
      </div>
    </Transition>
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
.slide-header,
.slide-footer {
  position: absolute;
  z-index: 1;
  left: 0;
  right: 0;
  max-width: 90cqw;
  margin: 0 auto;
  text-align: center;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.slide-header {
  top: clamp(8px, 4cqh, 40px);
}
.slide-footer {
  bottom: clamp(8px, 4cqh, 40px);
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
  gap: 10px;
  max-width: 90cqw;
}
.wayfinding-book {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.wayfinding-reference {
  font-weight: 700;
  margin: 18px 0;
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
