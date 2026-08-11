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
let scanner: QrScanner | undefined

onMounted(async () => {
  if (!(await QrScanner.hasCamera())) {
    errorText.value = "This device doesn't have a usable camera."
    return
  }
  if (!videoEl.value) return
  // highlightScanRegion/highlightCodeOutline deliberately left off (they default to false) —
  // both make qr-scanner create and inject its own overlay <div> directly into the DOM outside
  // Vue's tracking, positioned over the video. Confirmed on a real device that this is worth
  // avoiding: the video was visibly live for a moment, then went solid black and stayed that
  // way on every attempt, including ones needing no fresh permission prompt — consistent with a
  // wrongly-sized/positioned overlay sitting on top of a camera feed that was never actually
  // interrupted, not the stream itself stopping. The plain video-only view loses the nice
  // scan-region outline but removes that entire class of DOM/CSS integration risk.
  scanner = new QrScanner(videoEl.value, (result) => emit('decoded', result.data), {
    preferredCamera: 'environment',
  })
  try {
    await scanner.start()
  } catch (error) {
    errorText.value =
      error instanceof Error
        ? `Couldn't access the camera: ${error.message}`
        : "Couldn't access the camera."
  }
})

onUnmounted(() => {
  scanner?.destroy()
  scanner = undefined
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
