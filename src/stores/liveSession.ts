import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Whether the operator is currently presenting to the audience display, and shared with
 * the router guard (router/index.ts) so leaving the workspace mid-presentation is blocked
 * app-wide — not just for the header's Home button, but any navigation attempt (browser
 * back, another link, etc.) while presenting.
 */
export const useLiveSessionStore = defineStore('liveSession', () => {
  const isPresenting = ref(false)
  /** Set by the router guard when it blocks a navigation; shown as a snackbar in App.vue. */
  const blockedMessage = ref<string>()

  return { isPresenting, blockedMessage }
})
