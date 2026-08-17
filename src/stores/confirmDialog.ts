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
  // Set only for confirmWithPhrase — ConfirmDialog.vue shows a text field and keeps Confirm
  // disabled until it exactly matches this, instead of a plain click-through button. For
  // destructive actions serious enough that a confirm dialog alone has already proven
  // misclickable in practice (see LibrarySyncSection.vue's Load Sample Data/Clear Existing Data
  // guards), not a default to reach for everywhere.
  const requiredPhrase = ref<string>()
  const typedPhrase = ref('')
  let resolvePromise: ((result: Response) => void) | null = null

  function confirm(text: string, label = 'Confirm'): Promise<boolean> {
    message.value = text
    confirmLabel.value = label
    saveLabel.value = undefined
    requiredPhrase.value = undefined
    typedPhrase.value = ''
    isOpen.value = true
    return new Promise((resolve) => {
      resolvePromise = (result) => resolve(result === 'confirm')
    })
  }

  /** Three-way prompt: Save & continue / discard & continue / Cancel. */
  function confirmWithSave(
    text: string,
    discardLabel: string,
    saveButtonLabel: string,
  ): Promise<Response> {
    message.value = text
    confirmLabel.value = discardLabel
    saveLabel.value = saveButtonLabel
    requiredPhrase.value = undefined
    typedPhrase.value = ''
    isOpen.value = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  /** Like confirm(), but Confirm stays disabled until the operator types `phrase` exactly —
   *  for actions where a plain confirm dialog is too easy to click through on reflex. */
  function confirmWithPhrase(text: string, phrase: string, label: string): Promise<boolean> {
    message.value = text
    confirmLabel.value = label
    saveLabel.value = undefined
    requiredPhrase.value = phrase
    typedPhrase.value = ''
    isOpen.value = true
    return new Promise((resolve) => {
      resolvePromise = (result) => resolve(result === 'confirm')
    })
  }

  function respond(result: Response) {
    if (result === 'confirm' && requiredPhrase.value !== undefined) {
      if (typedPhrase.value !== requiredPhrase.value) return
    }
    isOpen.value = false
    resolvePromise?.(result)
    resolvePromise = null
  }

  return {
    isOpen,
    message,
    confirmLabel,
    saveLabel,
    requiredPhrase,
    typedPhrase,
    confirm,
    confirmWithSave,
    confirmWithPhrase,
    respond,
  }
})
