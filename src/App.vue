<script setup lang="ts">
import { storeToRefs } from 'pinia'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useLiveSessionStore } from '@/stores/liveSession'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'

const { blockedMessage } = storeToRefs(useLiveSessionStore())
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())

// The router guard (router/index.ts) covers in-app navigation; this covers closing the
// tab/window entirely, which a route guard can't intercept.
window.addEventListener('beforeunload', (event) => {
  if (isDirty.value) event.preventDefault()
})
</script>

<template>
  <v-app>
    <v-app-bar density="compact" elevation="0" class="border-b">
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
      <v-btn to="/" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-home">Home</v-btn>
      <v-btn to="/library/songs" variant="flat" color="secondary" class="mr-2" prepend-icon="mdi-bookshelf">
        Library
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
  </v-app>
</template>
