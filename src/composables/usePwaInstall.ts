/**
 * Surfaces the browser's "install this as an app" flow where one exists (Android/desktop
 * Chrome's `beforeinstallprompt`), and flags iOS Safari separately since it has no programmatic
 * install API at all — the only way there is the user manually tapping Share → Add to Home
 * Screen, so the best this can do is show a persistent instruction rather than a button.
 */
import { onMounted, onUnmounted, ref } from 'vue'

// Not in TS's DOM lib yet (still a draft/Chromium-only API) — same reasoning
// @types/wicg-file-system-access was needed for showDirectoryPicker().
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwaInstall() {
  const canInstall = ref(false)
  const isIos = ref(false)
  // Exposed (not just used internally to gate isIos) so BootGate.vue's chooser can nudge
  // "install first" more prominently for the QR scanner specifically when it isn't already
  // running installed — see that file's own reasoning for why installing first matters there.
  const isStandalone = ref(false)
  let deferredPrompt: BeforeInstallPromptEvent | undefined

  function onBeforeInstallPrompt(event: Event) {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    canInstall.value = true
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    // Already-installed (standalone display mode) never needs either UI.
    isStandalone.value = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
    isIos.value = !isStandalone.value && /iphone|ipad|ipod/i.test(navigator.userAgent)
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  })

  async function promptInstall(): Promise<void> {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = undefined
    canInstall.value = false
  }

  return { canInstall, isIos, isStandalone, promptInstall }
}
