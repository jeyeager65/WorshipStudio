import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * One entry in the undo stack (spec section 16). A destructive/edit action applies its
 * change to local state immediately (no blocking confirm dialog), then registers here with
 * enough to reverse it. If the action has a consequence beyond local state — e.g. actually
 * deleting a library file — that consequence belongs in onExpire, not performed up front, so
 * Undo can still fully reverse a still-pending action.
 */
export interface UndoToast {
  id: string
  message: string
  undo: () => void
  onExpire?: () => void
  durationMs: number
}

const DEFAULT_DURATION_MS = 6000

export const useUndoStore = defineStore('undo', () => {
  const toasts = ref<UndoToast[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Lets a view reserve space above its own fixed-position bottom bar (e.g. the Service
  // Workspace's live-transport footer) so the toast stack doesn't render on top of controls
  // that need to stay clickable during a live service. Set on mount, cleared on unmount —
  // same convention as useUnsavedChangesStore's saveHandler.
  const bottomOffsetPx = ref(0)

  function push(message: string, undo: () => void, onExpire?: () => void, durationMs = DEFAULT_DURATION_MS) {
    const id = crypto.randomUUID()
    toasts.value.unshift({ id, message, undo, onExpire, durationMs })
    timers.set(
      id,
      setTimeout(() => resolve(id, false), durationMs),
    )
  }

  function resolve(id: string, undone: boolean) {
    const index = toasts.value.findIndex((t) => t.id === id)
    if (index === -1) return
    const [toast] = toasts.value.splice(index, 1)
    clearTimeout(timers.get(id))
    timers.delete(id)
    if (undone) toast.undo()
    else toast.onExpire?.()
  }

  function undo(id: string) {
    resolve(id, true)
  }
  function dismiss(id: string) {
    resolve(id, false)
  }

  return { toasts, push, undo, dismiss, bottomOffsetPx }
})
