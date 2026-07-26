<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useTheme } from 'vuetify'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRoute, useRouter } from 'vue-router'
import { getAdapter } from '@/adapters'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import UndoToastStack from '@/components/UndoToastStack.vue'
import PresentationView from '@/views/PresentationView.vue'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'

const { blockedMessage } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())

// The presentation window (see src/adapters/tauri/index.ts's `live` port) loads this same
// app bundle in a second native window labeled "presentation" — never reached through
// routing, since it isn't the main window at all. Everything else below (app-bar, nav,
// router-view) is only ever what the operator window shows. Checking the Tauri window
// label rather than the URL avoids any question of whether a query string/path survives
// however Tauri serves the bundled frontend to a freshly created window.
const isPresentationWindow =
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__ && getCurrentWindow().label === 'presentation'

// The router guard (router/index.ts) covers in-app navigation; this covers closing the
// tab/window entirely, which a route guard can't intercept.
window.addEventListener('beforeunload', (event) => {
  if (isDirty.value) event.preventDefault()
})

// Dark mode (Settings → General) is a per-machine preference, applied once at startup
// here rather than re-read on every screen — SettingsView just needs to update
// theme.global.name itself when the user flips the toggle.
const theme = useTheme()
const router = useRouter()
const route = useRoute()
// The wizard is a forced, standalone first-run flow (see App.vue's redirect below and
// SettingsView's "Run First-Time Setup Wizard") — showing the normal nav alongside it would
// let the operator wander off mid-setup, defeating the point.
const isSetupWizard = computed(() => route.name === 'setup-wizard')
onMounted(async () => {
  const machineSettings = await getAdapter().settings.getMachineSettings()
  theme.change(machineSettings.darkMode ? 'worshipDark' : 'worshipLight')

  // First launch (or an upgrade from before this flag existed) — send the operator through
  // the wizard once before anything else. Direct navigation to any other route still works
  // normally afterward; this only fires on the very first paint.
  if (!isPresentationWindow && !machineSettings.hasCompletedSetup && router.currentRoute.value.path !== '/setup') {
    router.replace('/setup')
  }
})
</script>

<template>
  <PresentationView v-if="isPresentationWindow" />
  <v-app v-else>
    <v-app-bar v-if="!isSetupWizard" density="compact" elevation="0" class="border-b">
      <v-spacer />
      <span v-if="saveHandler" class="text-caption text-medium-emphasis mr-3">
        {{ saving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'All changes saved' }}
      </span>
      <v-btn
        v-if="saveHandler"
        variant="flat"
        color="primary"
        class="mr-3"
        prepend-icon="mdi-content-save"
        :loading="saving"
        :disabled="!isDirty"
        @click="saveHandler"
      >
        Save
      </v-btn>
      <v-divider v-if="saveHandler" vertical inset class="mr-3" />
      <v-btn to="/" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-home">Home</v-btn>
      <v-btn to="/library/songs" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-bookshelf">
        Library
      </v-btn>
      <v-btn to="/library/slides" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-image-multiple">
        Slides
      </v-btn>
      <v-btn to="/library/media" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-file-image-outline">
        Media
      </v-btn>
      <v-btn to="/settings" variant="flat" color="secondary" class="mr-3" prepend-icon="mdi-cog">
        Settings
      </v-btn>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>

    <v-snackbar
      :model-value="!!blockedMessage"
      color="error"
      timeout="4000"
      @update:model-value="(open: boolean) => !open && (blockedMessage = undefined)"
    >
      {{ blockedMessage }}
    </v-snackbar>

    <ConfirmDialog />
    <UndoToastStack />
  </v-app>
</template>
