<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getAdapter } from '@/adapters'
import type { Service } from '@/models/service'

const route = useRoute()
const service = ref<Service | undefined>()

onMounted(async () => {
  service.value = await getAdapter().services.get(route.params.id as string)
})
</script>

<template>
  <v-container fluid>
    <p v-if="!service">Placeholder — main workspace (M4).</p>
    <div v-else>
      <h1 class="text-h5">{{ service.date }} — {{ service.type }}</h1>
    </div>
  </v-container>
</template>
