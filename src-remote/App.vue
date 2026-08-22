<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import ConnectionStatus from './components/ConnectionStatus.vue'
import RemoteMirror from './components/RemoteMirror.vue'
import ControlsFullControl from './components/ControlsFullControl.vue'
import { usePoll } from './composables/usePoll'

const { state, connected, unpaired, retryAfterPairing } = usePoll()

function reload() {
  window.location.reload()
}

// Recovery path for iOS's "Add to Home Screen" storage isolation: the pairing link the operator
// shows (PersonEditorView.vue's Pair a Device dialog) sets an HttpOnly cookie when *visited*
// (src-tauri/src/remote_server.rs's /pair handler) — fine for Android (link taps often route
// straight into an already-installed PWA there) or for using this page directly in a browser
// tab, but iOS always opens a tapped/scanned link in a plain Safari tab, a completely separate
// storage partition from a home-screen-installed copy of this same page. Pairing while scanning
// in Safari, then adding to home screen afterward, leaves the *installed* copy looking
// permanently unpaired — it never saw that cookie. This input lets pairing happen again from
// wherever the page is *actually* running right now (a plain fetch() call, same-origin, so its
// Set-Cookie lands in whatever storage context made the request) — paste the link (or just the
// raw token) after installing, and it's paired correctly in the copy that's actually going to be
// used going forward. Same reasoning already applied to the tablet build's own connect-code flow
// (see BootGate.vue's own doc comment).
const pairInput = ref('')
const pairing = ref(false)
const pairError = ref('')

function extractPairToken(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  try {
    return new URL(trimmed).searchParams.get('token') ?? undefined
  } catch {
    // Not a URL — maybe they pasted just the raw token itself.
    return trimmed
  }
}

async function submitPairInput() {
  const token = extractPairToken(pairInput.value)
  if (!token) {
    pairError.value = "That doesn't look like a pairing link. Ask the operator to show it again."
    return
  }
  pairError.value = ''
  pairing.value = true
  try {
    const res = await fetch(`/pair?token=${encodeURIComponent(token)}`)
    if (!res.ok) {
      pairError.value = 'That pairing link has expired or was revoked. Ask the operator for a new one.'
      return
    }
    pairInput.value = ''
    retryAfterPairing()
  } catch {
    pairError.value = "Couldn't reach Worship Studio. Check the connection and try again."
  } finally {
    pairing.value = false
  }
}

// Same format describeSlide() in useLiveTransport.ts builds each slide's own label from — lets
// SlidePicker highlight the live entry by a plain string match (see its own doc comment).
const currentLabel = computed(() =>
  state.value?.content ? `${state.value.content.itemLabel} — ${state.value.content.subLabel}` : undefined,
)

// View Only has no control chrome at all (feature-spec.md section 4) — nothing to move into
// reclaimed space, so it keeps the simpler full-bleed mirror with its own internal letterbox
// bars (RemoteMirror.vue's default behavior) rather than the adaptive layout below.
const hasControls = computed(() => state.value?.accessLevel === 'full-control')

// A Full Control device can still just want the confidence-monitor view — access isn't the
// same as wanting to drive it from this particular phone. Purely a local display preference
// (never sent to the server, doesn't touch access_level), persisted so it survives a reload
// rather than resetting every time this page opens.
const CONTROLS_HIDDEN_KEY = 'ws-remote-controls-hidden'
const controlsHidden = ref(localStorage.getItem(CONTROLS_HIDDEN_KEY) === 'true')
watch(controlsHidden, (hidden) => localStorage.setItem(CONTROLS_HIDDEN_KEY, String(hidden)))
// What actually drives the adaptive layout below — a hidden-by-choice panel should behave
// exactly like View Only having none at all (full-bleed mirror, no reserved space), not leave
// a mirror shrunk down for a Controls panel nobody asked to see right now.
const showControlsPanel = computed(() => hasControls.value && !controlsHidden.value)

// A mirror box shaped differently from the real display always ends up with either top/bottom
// or left/right black bars (RemoteMirror.vue letterboxes/pillarboxes it) — but a full-bleed box
// only needs to be exactly that big if there's nothing else to put in the freed space. Given
// controls to show, shrink the mirror to the display's own aspect ratio instead and let Controls
// claim whichever axis has the slack: below it when the display is proportionally wider than the
// available area (freed vertical room), beside it when narrower (freed horizontal room) — the
// same shape black bars would otherwise have occupied, just handed to real UI instead.
const contentAreaRef = ref<HTMLElement>()
const contentWidth = ref(0)
const contentHeight = ref(0)
const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0]
  if (entry) {
    contentWidth.value = entry.contentRect.width
    contentHeight.value = entry.contentRect.height
  }
})
// contentAreaRef's own element comes and goes with `connected` (see the template's v-if/v-else
// below) — a one-time onMounted().observe() would only ever watch the very first element and go
// stale forever after the first disconnect/reconnect cycle, since a *new* content-area div is
// created on reconnect that nothing ever tells the observer about. Watching the ref itself
// re-subscribes to whatever element is current every time it changes, including back to none
// while disconnected (unobserve rather than a stale reference lingering on a detached node).
watch(
  contentAreaRef,
  (el, previousEl) => {
    if (previousEl) resizeObserver.unobserve(previousEl)
    if (el) resizeObserver.observe(el)
  },
  { immediate: true },
)
onUnmounted(() => resizeObserver.disconnect())

const displayAspect = computed(() => {
  const size = state.value?.displaySize
  return size && size.height > 0 ? size.width / size.height : 16 / 9
})
const contentAspect = computed(() =>
  contentHeight.value > 0 ? contentWidth.value / contentHeight.value : displayAspect.value,
)
// Display proportionally narrower than the available area → pillarboxed if left full-bleed →
// move Controls beside it instead.
const isSideBySide = computed(
  () => showControlsPanel.value && displayAspect.value < contentAspect.value,
)
// A wide tablet in landscape can have a display aspect close enough to the content area's own
// shape that the mirror's "fit exactly" width leaves almost nothing beside it — a fixed-width
// Prev/Next button or a slide row can only shrink so far before it stops being usable. Matches
// CONTROLS_MIN_WIDTH in the stylesheet below (kept as one named value, not duplicated, since a
// mismatch between the two would silently reintroduce this exact bug).
const CONTROLS_MIN_WIDTH = 280
const mirrorStyle = computed(() => {
  if (!showControlsPanel.value) return {}
  if (isSideBySide.value) {
    const idealWidth = contentHeight.value * displayAspect.value
    const availableWidth = Math.max(contentWidth.value - CONTROLS_MIN_WIDTH, 0)
    const width = Math.min(idealWidth, availableWidth)
    return { width: `${width}px`, height: `${width / displayAspect.value}px` }
  }
  return { width: '100%', height: `${contentWidth.value / displayAspect.value}px` }
})
// Stacked with controls below (not side-by-side) is exactly the "would have letterboxed
// top/bottom" case — that freed vertical room is enough to default the slide picker open
// rather than leaving it collapsed behind an extra tap.
const spacious = computed(() => showControlsPanel.value && !isSideBySide.value)
</script>

<template>
  <div v-if="unpaired" class="unpaired-message">
    <p class="unpaired-title">This device is no longer paired.</p>
    <p class="unpaired-hint">
      Ask the operator for a new pairing link from your Person record (People), or paste one
      below — this also fixes an iOS-only issue where pairing while scanning in Safari doesn't
      carry over once the app is added to the Home Screen, since that's a separate copy with its
      own storage.
    </p>
    <textarea
      v-model="pairInput"
      class="pair-input"
      placeholder="Paste the pairing link here"
      rows="3"
    />
    <button
      type="button"
      class="retry-btn"
      :disabled="!pairInput.trim() || pairing"
      @click="submitPairInput"
    >
      {{ pairing ? 'Pairing…' : 'Pair This Device' }}
    </button>
    <p v-if="pairError" class="pair-error">{{ pairError }}</p>
  </div>
  <div v-else class="layout">
    <ConnectionStatus
      :connected="connected"
      :device-name="state?.deviceName"
      :is-presenting="!!state?.isPresenting"
      :show-controls-toggle="hasControls"
      :controls-hidden="controlsHidden"
      @toggle-controls="controlsHidden = !controlsHidden"
    />
    <div v-if="!connected" class="disconnected-message">
      <p class="disconnected-title">Not connected to Worship Studio</p>
      <p class="disconnected-hint">Trying to reconnect automatically…</p>
      <button type="button" class="retry-btn" @click="reload">Try Again</button>
    </div>
    <div v-else ref="contentAreaRef" class="content-area" :class="{ 'side-by-side': isSideBySide }">
      <RemoteMirror
        :content="state?.content"
        :external-app-active="!!state?.isPresenting && !!state?.externalAppActive"
        :external-app-commands="state?.externalAppCommands"
        :is-blank-screen="!!state?.isPresenting && !!state?.isBlankScreen"
        :display-size="state?.displaySize"
        :has-controls="hasControls"
        class="mirror-slot"
        :class="{ 'mirror-slot--fitted': showControlsPanel }"
        :style="mirrorStyle"
      />
      <ControlsFullControl
        v-if="showControlsPanel"
        class="controls-slot"
        :is-presenting="!!state?.isPresenting"
        :service-open="!!state?.serviceOpen"
        :slides="state?.slides ?? []"
        :current-label="currentLabel"
        :is-blank-screen="!!state?.isBlankScreen"
        :background-only="!!state?.backgroundOnly"
        :spacious="spacious"
      />
    </div>
  </div>
</template>

<style scoped>
.unpaired-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ws-space-2);
  padding: var(--ws-space-6);
  text-align: center;
  color: var(--ws-text-secondary);
}
.unpaired-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ws-text-primary);
}
.unpaired-hint {
  max-width: 420px;
  font-size: 0.85rem;
  line-height: 1.4;
}
.pair-input {
  width: 100%;
  max-width: 420px;
  margin-top: var(--ws-space-2);
  padding: var(--ws-space-2) var(--ws-space-3);
  border: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
  border-radius: var(--ws-radius-md);
  background: transparent;
  color: var(--ws-text-primary);
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
}
.pair-error {
  max-width: 420px;
  color: #ff6b6b;
  font-size: 0.82rem;
}
.disconnected-message {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ws-space-2);
  padding: var(--ws-space-6);
  text-align: center;
}
.disconnected-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ws-text-primary);
}
.disconnected-hint {
  color: var(--ws-text-secondary);
  font-size: 0.85rem;
}
.retry-btn {
  margin-top: var(--ws-space-2);
  padding: var(--ws-space-2) var(--ws-space-5);
  border: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
  border-radius: var(--ws-radius-lg);
  background: transparent;
  color: var(--ws-primary);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.retry-btn:active {
  background: rgba(255, 255, 255, 0.08);
}
.retry-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.content-area {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.content-area.side-by-side {
  flex-direction: row;
  /* The mirror's height no longer always matches the container's (see CONTROLS_MIN_WIDTH in
     the script) — centered rather than stuck to the top when it's been clamped narrower. */
  align-items: center;
}
.mirror-slot {
  flex: 1;
  min-height: 0;
}
.mirror-slot--fitted {
  flex: none;
}
.controls-slot {
  flex: 1;
  /* Matches CONTROLS_MIN_WIDTH in the script — belt-and-suspenders in case of any rounding
     drift in that computation, not the primary mechanism (the mirror is what actually shrinks
     to make room; this just guarantees the panel itself is never squeezed past usable). */
  min-width: 280px;
  min-height: 0;
  overflow-y: auto;
}
.content-area.side-by-side .controls-slot {
  border-left: 1px solid rgba(255, 255, 255, var(--ws-border-opacity));
}
</style>
