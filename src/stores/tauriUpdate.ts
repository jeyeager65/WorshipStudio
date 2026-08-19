import { defineStore } from 'pinia'
import { ref } from 'vue'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

/**
 * Shared Tauri-updater state — a Pinia store (not a plain composable like usePwaUpdate.ts)
 * specifically because this needs to be read/driven from two independent places at once: the
 * always-on background check (composables/useTauriUpdate.ts, called once from App.vue) and the
 * manual "Check for Updates" button (AboutSection.vue). A plain composable would give each call
 * site its own separate refs; this store is the single shared source of truth both read from and
 * act on.
 */
export const useTauriUpdateStore = defineStore('tauriUpdate', () => {
  const updateAvailable = ref(false)
  const checking = ref(false)
  const applying = ref(false)
  const checkError = ref('')
  // Distinguishes "never checked yet" from "checked, nothing found" — without this,
  // AboutSection.vue's "You're up to date" could show for a moment before the very first
  // background check (useTauriUpdate.ts's onMounted) has actually resolved.
  const hasChecked = ref(false)
  let pendingUpdate: Update | undefined

  async function checkForUpdate(): Promise<void> {
    if (checking.value || applying.value) return
    checking.value = true
    checkError.value = ''
    try {
      pendingUpdate = (await check()) ?? undefined
      updateAvailable.value = !!pendingUpdate
      hasChecked.value = true
    } catch (error) {
      checkError.value = error instanceof Error ? error.message : 'Could not check for updates.'
    } finally {
      checking.value = false
    }
  }

  /** Downloads, installs, and relaunches — the operator only ever reaches this by tapping
   *  "Update Now"/"Install Now" (App.vue's banner, AboutSection.vue's button), never
   *  automatically; see useTauriUpdate.ts's own doc comment for why. */
  async function applyUpdate(): Promise<void> {
    if (!pendingUpdate || applying.value) return
    applying.value = true
    checkError.value = ''
    try {
      await pendingUpdate.downloadAndInstall()
      await relaunch()
    } catch (error) {
      checkError.value =
        error instanceof Error ? error.message : 'The update could not be installed.'
      applying.value = false
    }
  }

  return {
    updateAvailable,
    checking,
    applying,
    checkError,
    hasChecked,
    checkForUpdate,
    applyUpdate,
  }
})
