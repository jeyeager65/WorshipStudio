import { ref } from 'vue'

// Server-side is the real gate (action_allowed() in remote_server.rs) — this composable never
// duplicates that logic, it just posts and surfaces whether the attempt succeeded so a control
// can show a brief error state instead of silently doing nothing.
export function useRemoteAction() {
  const pending = ref(false)

  async function sendAction(
    action: string,
    extra?: { index?: number; serviceId?: string },
  ): Promise<boolean> {
    pending.value = true
    try {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      return res.ok
    } catch {
      return false
    } finally {
      pending.value = false
    }
  }

  return { pending, sendAction }
}
