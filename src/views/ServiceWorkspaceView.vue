<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getAdapter } from '@/adapters'
import type { Service } from '@/models/service'

const route = useRoute()
const service = ref<Service | undefined>()

onMounted(async () => {
  const id = route.params.id as string
  if (id !== 'new') {
    service.value = await getAdapter().services.get(id)
  }
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
