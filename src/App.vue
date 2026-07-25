<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useLiveSessionStore } from '@/stores/liveSession'

const { blockedMessage } = storeToRefs(useLiveSessionStore())
</script>

<template>
  <v-app>
    <v-app-bar density="compact" elevation="0" class="border-b">
      <template #prepend>
        <v-icon icon="mdi-book-cross" color="primary" class="ml-3 mr-1" />
      </template>
      <v-app-bar-title class="font-weight-bold">Worship Studio</v-app-bar-title>
      <v-btn to="/" variant="tonal" color="primary" class="btn-bordered mr-2" prepend-icon="mdi-home">Home</v-btn>
      <v-btn to="/library/songs" variant="tonal" color="primary" class="btn-bordered mr-2" prepend-icon="mdi-bookshelf">
        Library
      </v-btn>
      <v-btn to="/settings" variant="tonal" color="primary" class="btn-bordered mr-3" prepend-icon="mdi-cog">
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
  </v-app>
</template>
