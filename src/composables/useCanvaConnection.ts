import { onUnmounted, ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { CanvaStatus } from '@/adapters/types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Extracted from CanvaSection.vue (Settings) and the old inline Canva dialog in
// SlideEditorView.vue, which both polled canva.status() once a second until connected/errored —
// now shared by CanvaImportDialog.vue too. CanvaSection.vue itself isn't retrofitted onto this;
// its own connect flow needs nothing else this composable offers.
export function useCanvaConnection() {
  const status = ref<CanvaStatus>()
  const connecting = ref(false)
  const error = ref('')
  let statusTimer: ReturnType<typeof setInterval> | undefined

  function stopPolling() {
    if (statusTimer) clearInterval(statusTimer)
    statusTimer = undefined
  }

  async function refreshStatus() {
    const canva = getAdapter().canva
    if (!canva) return
    try {
      status.value = await canva.status()
    } catch (err) {
      error.value = errorMessage(err)
    }
  }

  async function connect() {
    const canva = getAdapter().canva
    if (!canva) return
    error.value = ''
    connecting.value = true
    try {
      await canva.connect()
      status.value = await canva.status()
      stopPolling()
      statusTimer = setInterval(async () => {
        try {
          status.value = await canva.status()
          if (status.value.connected || status.value.error) stopPolling()
        } catch (err) {
          error.value = errorMessage(err)
          stopPolling()
        }
      }, 1000)
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      connecting.value = false
    }
  }

  async function disconnect() {
    const canva = getAdapter().canva
    if (!canva) return
    error.value = ''
    stopPolling()
    try {
      await canva.disconnect()
      await refreshStatus()
    } catch (err) {
      error.value = errorMessage(err)
    }
  }

  onUnmounted(stopPolling)

  return { status, connecting, error, refreshStatus, connect, disconnect }
}
