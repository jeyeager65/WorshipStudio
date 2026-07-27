<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { formatCountdown } from '@/utils/countdown'
import { wrapLineAtPunctuation } from '@/utils/textAutoFit'
import type { LiveSlideContent } from '@/adapters/types'

/**
 * The audience-facing window (see src/adapters/tauri/index.ts's `live` port) — never routed
 * to normally, only ever rendered when App.vue detects it's running in the "presentation"
 * Tauri window. No app-bar, no Vuetify: just the current slide, full-bleed.
 */
const current = ref<LiveSlideContent>()
let unlisten: UnlistenFn | undefined

// Song/scripture/text-slide/slide-ref items — the ones rendered by the plain "presentation-text"
// branch below, as opposed to wayfinding/media/countdown which have their own distinct designs
// and don't get a header/footer. Matches that branch's v-else-if fallthrough condition exactly.
const isTextSlide = computed(
  () => !!current.value && !current.value.wayfindingBooks && !current.value.media && !current.value.countdown,
)

// Its own ticking clock (spec section 1's Countdown slide type) — separate from the operator
// window's, since this is a different window/component entirely.
const nowTick = ref(new Date())
let nowTickInterval: ReturnType<typeof setInterval> | undefined

// Auto-fit sizing (spec section 1): flattenService already decided *how much content* goes
// on this slide (verse-boundary-safe splitting for scripture, one block per slide for songs —
// see utils/flattenService.ts); this is the real measurement pass, against this window's
// actual pixel size, that picks the largest font size within current.fontRange that doesn't
// overflow. Scripture's text is one flowing paragraph and just uses the browser's own
// wrapping (measured via the live element's scrollHeight); song blocks set `lineWrap` so each
// authored line only wraps if it truly doesn't fit, preferring a break at a comma/semicolon
// over an arbitrary word boundary (see wrapLineAtPunctuation) — that requires computing the
// wrapped text ourselves via real canvas measurement rather than just reading scrollHeight,
// since the *choice* of where to break has to be made before anything is rendered. Other
// slide types (plain text-slides) don't set fontRange, so they keep the static CSS clamp below
// untouched.
const rootRef = ref<HTMLElement>()
const textRef = ref<HTMLElement>()
const fittedFontSizePx = ref<number>()
const displayText = ref('')
let resizeObserver: ResizeObserver | undefined

// Matches .presentation-text's line-height below — used to convert a wrapped line count into
// an estimated pixel height for the song/lineWrap path's candidate-size search.
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
  const range = current.value?.fontRange
  const root = rootRef.value
  const text = textRef.value
  const rawText = current.value?.text ?? ''
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

  if (current.value?.lineWrap) {
    const maxWidthPx = root.clientWidth * 0.9 // matches .presentation-content's max-width: 90vw
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
      const wrapped = rawLines.flatMap((line) => (line ? wrapLineAtPunctuation(line, maxWidthPx, (t) => measureTextWidthPx(t, font)) : ['']))
      text.style.fontSize = `${best}px`
      displayText.value = wrapped.join('\n')
    }
  } else {
    // Vue's reactive update to displayText only patches the DOM on its next tick, not
    // synchronously here — measuring scrollHeight immediately after just setting the ref would
    // read the *previous* slide's leftover text, picking the wrong size for the new content
    // (reported bug: scripture sometimes rendered too large and didn't all fit). Writing
    // textContent directly makes the measurement see the real, current text right now.
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
  () => [current.value?.text, current.value?.fontRange, current.value?.lineWrap, current.value?.itemLabel] as const,
  () => nextTick(fitAutoSizedText),
  { flush: 'post' },
)

onMounted(async () => {
  unlisten = await listen<LiveSlideContent | null>('live:slide-changed', (event) => {
    current.value = event.payload ?? undefined
  })
  // Tells the operator window's adapter this window is actually listening now, so it can
  // (re)send the current slide — see the matching comment in openPresentationWindow().
  await emit('presentation:ready')
  nowTickInterval = setInterval(() => (nowTick.value = new Date()), 1000)
  if (rootRef.value) {
    resizeObserver = new ResizeObserver(() => fitAutoSizedText())
    resizeObserver.observe(rootRef.value)
  }
})
onUnmounted(() => {
  unlisten?.()
  clearInterval(nowTickInterval)
  resizeObserver?.disconnect()
})

// Wayfinding (reference-only scripture, spec section 1): books further from the current one
// shrink and fade, one fade level per book regardless of length — mirrors flipping through a
// physical Bible and seeing nearby book names.
function bookStyle(distance: number) {
  const level = Math.abs(distance)
  const sizes = ['clamp(16px, 3vw, 34px)', 'clamp(12px, 2vw, 24px)']
  const opacities = [0.55, 0.3]
  return { fontSize: sizes[level - 1] ?? sizes[sizes.length - 1], opacity: opacities[level - 1] ?? opacities[opacities.length - 1] }
}
</script>

<template>
  <div ref="rootRef" class="presentation-root">
    <div v-if="current?.wayfindingBooks" class="wayfinding-content">
      <div
        v-for="book in current.wayfindingBooks.filter((b) => b.distance < 0)"
        :key="book.name"
        class="wayfinding-book"
        :style="bookStyle(book.distance)"
      >
        {{ book.name }}
      </div>
      <div class="wayfinding-reference">{{ current.itemLabel }}</div>
      <div
        v-for="book in current.wayfindingBooks.filter((b) => b.distance > 0)"
        :key="book.name"
        class="wayfinding-book"
        :style="bookStyle(book.distance)"
      >
        {{ book.name }}
      </div>
    </div>
    <img
      v-else-if="current?.media?.kind === 'image'"
      :key="current.media.url"
      :src="current.media.url"
      class="media-fill"
      :style="{ objectFit: current.media.fit }"
      alt=""
    />
    <video
      v-else-if="current?.media?.kind === 'video'"
      :key="current.media.url"
      :src="current.media.url"
      class="media-fill"
      :style="{ objectFit: current.media.fit }"
      autoplay
      controls
    />
    <div v-else-if="current?.countdown" class="presentation-content">
      <div v-if="current.countdown.text" class="presentation-label" style="text-transform: none; letter-spacing: normal">
        {{ current.countdown.text }}
      </div>
      <div class="countdown-clock">{{ formatCountdown(current.countdown.targetTime, nowTick) }}</div>
    </div>
    <div v-else-if="current" class="presentation-content">
      <div
        ref="textRef"
        class="presentation-text"
        :style="{
          ...(current.fontRange ? { fontSize: `${fittedFontSizePx ?? current.fontRange.maxPx}px` } : {}),
          // Song lines must never wrap except where we've explicitly inserted a break (see
          // wrapLineAtPunctuation) — `pre-line` still lets the browser wrap a preserved line
          // that doesn't fit, which silently undid the comma/semicolon-only rule for any line
          // with no punctuation to break at (e.g. 'Amazing grace! How sweet the sound').
          // Scripture keeps normal paragraph wrapping.
          ...(current.lineWrap ? { whiteSpace: 'pre' } : {}),
        }"
      >
        {{ displayText }}
      </div>
    </div>

    <!-- Fixed position, fixed (configurable) size — unlike the auto-fit main text above, these
         never move or resize as that text shrinks/grows. Only for the plain text slide above;
         wayfinding/media/countdown have their own distinct designs. -->
    <div
      v-if="isTextSlide && current?.itemLabel"
      class="presentation-header"
      :style="{ fontSize: `${current?.headerFontSizePx ?? 24}px` }"
    >
      {{ current?.itemLabel }}
    </div>
    <div
      v-if="isTextSlide && current?.subLabel"
      class="presentation-footer"
      :style="{ fontSize: `${current?.footerFontSizePx ?? 24}px` }"
    >
      {{ current?.subLabel }}
    </div>
  </div>
</template>

<style scoped>
.presentation-root {
  width: 100vw;
  height: 100vh;
  background: #000;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.presentation-content {
  max-width: 90vw;
  text-align: center;
  /* A flex item's automatic min-width defaults to its content's natural size, which silently
     overrides max-width for unwrappable content (white-space: pre song lines, or any single
     word wider than the box) — the content would push this box past 90vw and off the right
     edge instead of respecting the cap. Per spec, giving the item its own overflow (anything
     but visible) resets that automatic minimum to 0, so max-width is actually honored; any
     text still too wide to fit is clipped here instead of bleeding past the viewport. */
  overflow: hidden;
}
.presentation-label {
  font-size: clamp(14px, 2vw, 28px);
  opacity: 0.6;
  margin-bottom: 24px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.presentation-header,
.presentation-footer {
  position: fixed;
  left: 0;
  right: 0;
  max-width: 90vw;
  margin: 0 auto;
  text-align: center;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.presentation-header {
  top: 40px;
}
.presentation-footer {
  bottom: 40px;
}
.presentation-text {
  font-size: clamp(28px, 5vw, 72px);
  font-weight: 600;
  line-height: 1.3;
  white-space: pre-line;
}
.media-fill {
  width: 100%;
  height: 100%;
}
.countdown-clock {
  font-size: clamp(48px, 10vw, 140px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.wayfinding-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.wayfinding-book {
  font-weight: 600;
  letter-spacing: 0.04em;
}
.wayfinding-reference {
  font-size: clamp(40px, 7vw, 90px);
  font-weight: 700;
  margin: 18px 0;
}
</style>
