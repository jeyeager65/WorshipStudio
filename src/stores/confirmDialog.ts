import { defineStore } from 'pinia'
import { ref } from 'vue'

type Response = 'confirm' | 'save' | 'cancel'

/**
 * Generic confirm modal, driven from anywhere (including async contexts like router guards)
 * via `confirm(message)` (plain yes/no) or `confirmWithSave(message, ...)` (adds a third
 * "Save & ___" option, for prompts where discarding isn't the only alternative to canceling —
 * see the unsaved-changes router guard). Replaces window.confirm so the prompt matches the
 * app's UI instead of the browser's.
 */
export const useConfirmDialogStore = defineStore('confirmDialog', () => {
  const isOpen = ref(false)
  const message = ref('')
  const confirmLabel = ref('Confirm')
  // Set only for confirmWithSave — ConfirmDialog.vue shows a third button when this is present.
  const saveLabel = ref<string>()
  let resolvePromise: ((result: Response) => void) | null = null

  function confirm(text: string, label = 'Confirm'): Promise<boolean> {
    message.value = text
    confirmLabel.value = label
    saveLabel.value = undefined
    isOpen.value = true
    return new Promise((resolve) => {
      resolvePromise = (result) => resolve(result === 'confirm')
    })
  }

  /** Three-way prompt: Save & continue / discard & continue / Cancel. */
  function confirmWithSave(text: string, discardLabel: string, saveButtonLabel: string): Promise<Response> {
    message.value = text
    confirmLabel.value = discardLabel
    saveLabel.value = saveButtonLabel
    isOpen.value = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  function respond(result: Response) {
    isOpen.value = false
    resolvePromise?.(result)
    resolvePromise = null
  }

  return { isOpen, message, confirmLabel, saveLabel, confirm, confirmWithSave, respond }
})
