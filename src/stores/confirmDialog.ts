import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Generic yes/no confirm modal, driven from anywhere (including async contexts like
 * router guards) via `confirm(message)`, which resolves once the user responds.
 * Replaces window.confirm so the prompt matches the app's UI instead of the browser's.
 */
export const useConfirmDialogStore = defineStore('confirmDialog', () => {
  const isOpen = ref(false)
  const message = ref('')
  let resolvePromise: ((confirmed: boolean) => void) | null = null

  function confirm(text: string): Promise<boolean> {
    message.value = text
    isOpen.value = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  function respond(confirmed: boolean) {
    isOpen.value = false
    resolvePromise?.(confirmed)
    resolvePromise = null
  }

  return { isOpen, message, confirm, respond }
})
