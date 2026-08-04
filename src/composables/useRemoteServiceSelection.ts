import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { getAdapter } from '@/adapters'
import type { RemoteCommand } from '@/adapters/types'

/**
 * Always-mounted from App.vue rather than living inside ServiceWorkspaceView's own
 * `remote:command` listener (useLiveTransport.ts) — `select-service` is specifically meant to
 * work when nothing is presenting yet, quite possibly with no workspace open at all (the
 * operator sitting on the services list). Just opens the service — it deliberately does *not*
 * also start presenting; the phone only sees Start Presenting appear once `service_open`
 * (pushed by useLiveTransport.ts's own mount) confirms the workspace actually finished loading
 * it, and a distinct tap is what starts it. Selecting and presenting used to be one action;
 * splitting them was a deliberate choice so a remote device can't display something live before
 * anyone's actually looked at what's about to go up.
 *
 * `enabled` is a plain boolean, not a ref — App.vue computes it once from the current window's
 * label (presentation/identify/splash windows are separate Tauri windows running this same app
 * bundle and must never act on this), and a Tauri window's label can't change after creation.
 */
export function useRemoteServiceSelection(enabled: boolean) {
  const router = useRouter()
  let unlisten: (() => void) | undefined

  onMounted(async () => {
    if (!enabled) return
    unlisten = await getAdapter().remote?.onCommand((command: RemoteCommand) => {
      if (command.action === 'select-service' && command.serviceId) {
        router.push(`/service/${command.serviceId}`)
      }
    })
  })
  onUnmounted(() => unlisten?.())
}
