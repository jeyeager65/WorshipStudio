<script setup lang="ts">
/**
 * Self-contained camera view for scanning another device's "Add Another Device" QR code
 * (LibrarySyncSection.vue's generator) directly inside the running app — see BootGate.vue's own
 * doc comment for why this exists instead of just scanning with the OS camera app: iOS Safari has
 * no way to route a scanned link into an already-installed PWA, and even if it did, a plain
 * Safari tab and the installed app have completely separate storage anyway (confirmed against
 * WICG/pwa-url-handler#43). Scanning in-app means the whole connect flow stays in one JS session
 * with no navigation and no storage boundary to cross.
 *
 * Deliberately manages the camera stream itself (plain getUserMedia) and only uses qr-scanner's
 * *static* scanImage() on a timer, rather than constructing a full QrScanner instance and using
 * its own start()/pause() lifecycle. Confirmed on a real device this had to change: qr-scanner's
 * instance-level start() bails out silently whenever `document.hidden` is true, and it attaches
 * its own visibilitychange listener that pauses the stream the same way — the video was visibly
 * live for a moment, then went solid black and stayed that way, on every attempt, including ones
 * needing no fresh permission prompt. That's consistent with `document.hidden`/visibilitychange
 * behaving unreliably in an installed iOS PWA (a previously-documented category of iOS bug) and
 * the library's own pause firing without its matching resume ever following. A full QrScanner
 * instance only wires up that listener in its constructor, so simply never constructing one —
 * using only the stateless static methods (hasCamera, scanImage, createQrEngine) — removes the
 * entire dependency on that behaving correctly.
 *
 * Deliberately keeps scanning after every decode rather than stopping itself — an invalid QR code
 * (BootGate.vue's parseConnectLink rejecting it) should let the operator just try again without
 * this component needing to know why it failed or explicitly restart anything; a valid one causes
 * the parent to navigate away to a different phase, which unmounts this component and stops the
 * camera naturally via onUnmounted below.
 */
import { onMounted, onUnmounted, ref } from 'vue'
import QrScanner from 'qr-scanner'

const emit = defineEmits<{
  decoded: [text: string]
  cancel: []
}>()

const videoEl = ref<HTMLVideoElement>()
const errorText = ref('')
let stream: MediaStream | undefined
let qrEngine: Awaited<ReturnType<typeof QrScanner.createQrEngine>> | undefined
let scanIntervalId: ReturnType<typeof setInterval> | undefined

// Frequent enough to feel instant, cheap enough not to matter — the actual decode work runs in
// qrEngine (a Worker, or the native BarcodeDetector where available), never on the main thread.
const SCAN_INTERVAL_MS = 350

async function scanOnce() {
  const video = videoEl.value
  if (!video || video.readyState < video.HAVE_CURRENT_DATA) return
  try {
    const result = await QrScanner.scanImage(video, { qrEngine, returnDetailedScanResult: true })
    emit('decoded', result.data)
  } catch {
    // No QR code in this particular frame — the overwhelmingly common case on every tick, not a
    // real error worth surfacing (scanImage's documented behavior is to throw when it finds
    // nothing).
  }
}

onMounted(async () => {
  if (!(await QrScanner.hasCamera())) {
    errorText.value = "This device doesn't have a usable camera."
    return
  }
  if (!videoEl.value) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
    videoEl.value.srcObject = stream
    await videoEl.value.play()
    qrEngine = await QrScanner.createQrEngine()
    scanIntervalId = setInterval(() => void scanOnce(), SCAN_INTERVAL_MS)
  } catch (error) {
    errorText.value =
      error instanceof Error
        ? `Couldn't access the camera: ${error.message}`
        : "Couldn't access the camera."
  }
})

onUnmounted(() => {
  if (scanIntervalId !== undefined) clearInterval(scanIntervalId)
  stream?.getTracks().forEach((track) => track.stop())
  stream = undefined
})
</script>

<template>
  <div class="qr-scanner">
    <template v-if="!errorText">
      <video ref="videoEl" class="qr-scanner-video" muted playsinline></video>
      <p class="qr-scanner-hint">Point the camera at the QR code shown on the other device.</p>
    </template>
    <v-alert v-else type="error" variant="tonal" density="compact" class="qr-scanner-error">
      {{ errorText }}
    </v-alert>
    <v-btn variant="text" size="large" block class="mt-2" @click="emit('cancel')">Back</v-btn>
  </div>
</template>

<style scoped>
.qr-scanner {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.qr-scanner-video {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  background: black;
  object-fit: cover;
}
.qr-scanner-hint {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.8rem;
  text-align: center;
}
.qr-scanner-error {
  text-align: left;
}
</style>
