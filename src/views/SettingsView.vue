<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { LibrarySettings } from '@/models/settings'

const settings = ref<LibrarySettings | undefined>()

onMounted(async () => {
  settings.value = await getAdapter().settings.getLibrarySettings()
})
</script>

<template>
  <v-container>
    <h1 class="text-h5 mb-4">Settings</h1>
    <p v-if="settings">Church: {{ settings.branding.churchName }}</p>
  </v-container>
</template>
