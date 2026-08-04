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
 */
const props = withDefaults(
  defineProps<{
    content?: LiveSlideContent
    fixedSize?: { width: number; height: number }
    videoAutoplay?: boolean
    videoControls?: boolean
    videoMuted?: boolean
  }>(),
  { videoAutoplay: true, videoControls: true, videoMuted: false },
)

// Song/scripture/text-slide/slide-ref items — the ones rendered by the plain "slide-text"
// branch below, as opposed to wayfinding/media which have their own distinct designs and
// don't get a header/footer. Matches that branch's v-else-if fallthrough condition exactly.
const isTextSlide = computed(
  () =>
    !!props.content &&
    !props.content.backgroundOnly &&
    !props.content.scene &&
    !props.content.wayfindingBooks &&
    !props.content.media,
)

// Song slides override the footer with the song's own collection citation instead of the
// block label (see flattenService.ts's formatSongFooter) — footerText is only ever set (even
// to '', meaning "no collection, hide the footer") for song slides, so undefined here means
// "not a song slide, keep showing subLabel" for every other text-slide type.
const footerDisplayText = computed(() =>
  props.content?.footerText !== undefined ? props.content.footerText : props.content?.subLabel,
)

// Background Only is a presentation override, not a mutation of the saved scene. Advanced
// slides keep their configured color/image background while temporarily omitting every scene
// element; the other foreground-only slide types naturally fall back to the black canvas.
const renderedScene = computed(() => {
  const scene = props.content?.scene
  if (!scene || !props.content?.backgroundOnly) return scene
  return { ...scene, elements: [] }
})

const rootStyle = computed(() => {
  const theme = props.content?.presentationTheme
  return {
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
  const range = props.content?.fontRange
  const root = rootRef.value
  const text = textRef.value
  const rawText = props.content?.text ?? ''
  if (!range || !root || !text) {
    fittedFontSizePx.value = undefined
    displayText.value = rawText
    return
  }
  // Leaves headroom for the reference/translation label above the text and general breathing
  // room, rather than filling the window edge-to-edge.
  const maxHeightPx = root.clientHeight * 0.85
  let lo = Math.floor(range.minPx)
  let hi = Math.floor(range.maxPx)
  let best = lo

  if (props.content?.lineWrap) {
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
      props.content?.text,
      props.content?.fontRange,
      props.content?.lineWrap,
      props.content?.itemLabel,
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
})

// Wayfinding (reference-only scripture, spec section 1): books further from the current one
// shrink and fade, one fade level per book regardless of length — mirrors flipping through a
// physical Bible and seeing nearby book names. Size is linearly interpolated by distance
// between the configured max (Settings > Font Sizes; approached by the nearest book, used
// directly by the reference itself) and min (the farthest book actually shown) — using
// Math.abs on every distance here, not just the current one, since the farthest book present
// isn't always at the full configured radius (e.g. Revelation has no books after it).
function bookStyle(distance: number) {
  const level = Math.abs(distance)
  const maxPx = props.content?.wayfindingMaxFontSizePx ?? 150
  const minPx = props.content?.wayfindingMinFontSizePx ?? 56
  const radius = Math.max(
    1,
    ...(props.content?.wayfindingBooks ?? []).map((b) => Math.abs(b.distance)),
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
  if (props.content?.backgroundOnly) return undefined
  const bibleProgress = props.content?.bibleProgress
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
    <img
      v-if="content?.presentationTheme?.backgroundMedia?.kind === 'image'"
      :key="content.presentationTheme.backgroundMedia.url"
      :src="content.presentationTheme.backgroundMedia.url"
      class="theme-background"
      :style="{ objectFit: content.presentationTheme.backgroundMedia.fit }"
      alt=""
    />
    <video
      v-else-if="content?.presentationTheme?.backgroundMedia?.kind === 'video'"
      :key="content.presentationTheme.backgroundMedia.url"
      :src="content.presentationTheme.backgroundMedia.url"
      class="theme-background"
      :style="{ objectFit: content.presentationTheme.backgroundMedia.fit }"
      :autoplay="videoAutoplay"
      loop
      muted
      playsinline
    />
    <SlideSceneRenderer
      v-if="renderedScene"
      :scene="renderedScene"
      :service-date-time="content?.serviceDateTime"
    />
    <div v-else-if="content?.wayfindingBooks && !content.backgroundOnly" class="wayfinding-content">
      <div
        v-for="book in content.wayfindingBooks.filter((b) => b.distance < 0)"
        :key="book.name"
        class="wayfinding-book"
        :style="bookStyle(book.distance)"
      >
        {{ book.name }}
      </div>
      <div
        class="wayfinding-reference"
        :style="{ fontSize: `${content.wayfindingMaxFontSizePx ?? 150}px` }"
      >
        {{ content.itemLabel }}
      </div>
      <div
        v-for="book in content.wayfindingBooks.filter((b) => b.distance > 0)"
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
      <!-- A sibling of both the labels and the bar-wrapper (not nested in either) so its height
           can span from near the label text down through the bar — its left position is still
           a percentage of the same width as the bar below, since neither it nor the bar-wrapper
           add any side padding/margin. -->
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
          :style="{ left: `${(content?.bibleProgress ?? 0) * 100}%` }"
        />
      </div>
    </div>
    <img
      v-else-if="content?.media?.kind === 'image'"
      :key="content.media.url"
      :src="content.media.url"
      class="media-fill"
      :style="{ objectFit: content.media.fit }"
      alt=""
    />
    <video
      v-else-if="content?.media?.kind === 'video'"
      :key="content.media.url"
      :src="content.media.url"
      class="media-fill"
      :style="{ objectFit: content.media.fit }"
      :autoplay="videoAutoplay"
      :controls="videoControls"
      :muted="videoMuted"
    />
    <div
      v-else-if="content?.outlineTitle && !content.backgroundOnly"
      class="slide-content outline-content"
    >
      <div class="outline-title">{{ content.outlineTitle }}</div>
      <div v-if="content.text" class="outline-details">{{ content.text }}</div>
    </div>
    <div
      v-else-if="content && !content.backgroundOnly && !content.scene && !content.wayfindingBooks"
      class="slide-content"
    >
      <div
        ref="textRef"
        class="slide-text"
        :style="{
          ...(content.fontRange
            ? { fontSize: `${fittedFontSizePx ?? content.fontRange.maxPx}px` }
            : {}),
          // Song lines must never wrap except where we've explicitly inserted a break (see
          // wrapLineAtPunctuation) — `pre-line` still lets the browser wrap a preserved line
          // that doesn't fit, which silently undid the comma/semicolon-only rule for any line
          // with no punctuation to break at. Scripture keeps normal paragraph wrapping.
          ...(content.lineWrap ? { whiteSpace: 'pre' } : {}),
        }"
      >
        {{ displayText }}
      </div>
    </div>

    <!-- Fixed position, fixed (configurable) size — unlike the auto-fit main text above, these
         never move or resize as that text shrinks/grows. Only for the plain text slide above;
         wayfinding/media have their own distinct designs. -->
    <div
      v-if="isTextSlide && content?.itemLabel"
      class="slide-header"
      :style="{ fontSize: `${content?.headerFontSizePx ?? 48}px` }"
    >
      {{ content?.itemLabel }}
    </div>
    <div
      v-if="isTextSlide && footerDisplayText"
      class="slide-footer"
      :style="{ fontSize: `${content?.footerFontSizePx ?? 48}px` }"
    >
      {{ footerDisplayText }}
    </div>
    <div v-if="isTextSlide && content?.repeatLabel" class="slide-repeat-label">
      {{ content.repeatLabel }}
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
  top: 40px;
}
.slide-footer {
  bottom: 40px;
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
.wayfinding-progress-labels {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: clamp(18px, 2.6cqw, 34px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
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
