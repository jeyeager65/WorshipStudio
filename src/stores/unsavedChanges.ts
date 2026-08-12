import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Shared across every editing screen that uses an explicit Save button instead of
 * auto-save (Song Editor, the main workspace's arrangement/notes editing) — writing to a
 * Dropbox-synced JSON file on every keystroke/blur risks excessive sync churn and isn't
 * obviously visible to the user, so edits stay in-memory until Save is pressed. This flag
 * is what the router guard (router/index.ts) and the tab-close warning (App.vue) check to
 * avoid silently losing unsaved work.
 *
 * saveHandler/saving let the current screen's Save action live in the persistent app bar
 * (App.vue) instead of a per-page toolbar that would scroll out of view — whichever view is
 * mounted registers its own save function here and clears it on unmount, so the app bar
 * only shows a Save button when a screen actually has one.
 *
 * pageTitleOverride follows the same registration pattern for a deeper page (one with no
 * static router/index.ts meta.title) that still wants a dynamic title in the app bar — set on
 * mount/whenever its content changes, cleared on unmount, same as saveHandler above.
 *
 * navCollapseRequested is the same registration pattern again, this time for a page that wants
 * the nav rail collapsed below some width narrower than App.vue's own default (960px,
 * isNarrowWindow) — e.g. ServiceWorkspaceView.vue, which would rather give up the nav's labels
 * than its own Service Order List column. Set/cleared by a watcher on that page's own width
 * threshold, same lifecycle as pageTitleOverride.
 */
export const useUnsavedChangesStore = defineStore('unsavedChanges', () => {
  const isDirty = ref(false)
  const saving = ref(false)
  const saveHandler = ref<(() => void | Promise<void>) | undefined>()
  const pageTitleOverride = ref<string | undefined>()
  const navCollapseRequested = ref(false)
  return { isDirty, saving, saveHandler, pageTitleOverride, navCollapseRequested }
})
