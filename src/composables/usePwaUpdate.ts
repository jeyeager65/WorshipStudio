/**
 * Surfaces PWA update availability without ever reloading on its own — App.vue shows a small
 * banner when needRefresh becomes true, and only calls applyUpdate() (which activates the
 * waiting service worker and reloads the page) once the operator taps it. See vite.config.ts's
 * own comment for why registerType is 'prompt', not 'autoUpdate': an unprompted reload could land
 * mid-edit on a service, or worse, mid-presentation.
 *
 * A new service worker only gets installed (and needRefresh flipped to true) once the browser
 * actually checks for one — left to the browser's own default behavior, that mostly only happens
 * on a fresh page load/navigation. An installed PWA that just stays open for a long time
 * (especially on iOS, which suspends backgrounded tabs aggressively) never gets that check
 * naturally, which is why closing and reopening the app was the only way updates were ever
 * noticed on a real device. This calls registration.update() itself instead — once on mount,
 * whenever the tab becomes visible again, and on a timer while it stays visible (same trigger
 * shape as useTabletSync.ts's own sync checks) — so updates surface without a manual relaunch.
 */
import { getCurrentInstance, onMounted, onUnmounted } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { getAdapter } from '@/adapters'

const CHECK_INTERVAL_MS = 30 * 60 * 1000

export function usePwaUpdate() {
  const { needRefresh, updateServiceWorker } = useRegisterSW()
  let registration: ServiceWorkerRegistration | undefined
  let intervalId: ReturnType<typeof setInterval> | undefined

  // useRegisterSW's onRegisteredSW option only fires once, on the initial registration — reading
  // navigator.serviceWorker.ready separately here means checkForUpdate() still works correctly
  // even if this composable's own onMounted below runs before that first callback would have.
  void navigator.serviceWorker?.ready.then((reg) => {
    registration = reg
  })

  function checkForUpdate() {
    void registration?.update()
  }

  function stopInterval() {
    if (intervalId !== undefined) clearInterval(intervalId)
    intervalId = undefined
  }

  function startInterval() {
    stopInterval()
    intervalId = setInterval(checkForUpdate, CHECK_INTERVAL_MS)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      checkForUpdate()
      startInterval()
    } else {
      stopInterval()
    }
  }

  // Desktop (Tauri) has its own, unrelated updater — the service worker still gets registered
  // there (vite.config.ts builds the same bundle for every adapter kind), but polling for an
  // update it'll never apply is just pointless background work worth skipping.
  //
  // getCurrentInstance() guards the onMounted/onUnmounted registration for callers outside a
  // component setup context (e.g. a future non-Vue usage, or tests) — App.vue is the only real
  // caller today, always inside setup(), so this only matters as defensive future-proofing.
  if (getCurrentInstance()) {
    onMounted(() => {
      if (getAdapter().kind === 'tauri') return
      checkForUpdate()
      if (document.visibilityState === 'visible') startInterval()
      document.addEventListener('visibilitychange', onVisibilityChange)
    })

    onUnmounted(() => {
      stopInterval()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })
  }

  async function applyUpdate(): Promise<void> {
    await updateServiceWorker(true)
  }

  return { needRefresh, applyUpdate }
}
