import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Shared across every editing screen that uses an explicit Save button instead of
 * auto-save (Song Editor, the main workspace's arrangement/notes editing) — writing to a
 * Dropbox-synced JSON file on every keystroke/blur risks excessive sync churn and isn't
 * obviously visible to the user, so edits stay in-memory until Save is pressed. This flag
 * is what the router guard (router/index.ts) and the tab-close warning (App.vue) check to
 * avoid silently losing unsaved work.
 */
export const useUnsavedChangesStore = defineStore('unsavedChanges', () => {
  const isDirty = ref(false)
  return { isDirty }
})
