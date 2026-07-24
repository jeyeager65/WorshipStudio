<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { Service } from '@/models/service'

const services = ref<Service[]>([])

onMounted(async () => {
  services.value = await getAdapter().services.list()
})
</script>

<template>
  <v-container>
    <h1 class="text-h4 mb-4">Worship Studio</h1>
    <v-card v-for="service in services" :key="service.id" class="mb-2" :to="`/service/${service.id}`">
      <v-card-title>{{ service.date }} — {{ service.type }}</v-card-title>
      <v-card-subtitle>{{ service.sermonTitle }}</v-card-subtitle>
    </v-card>
    <v-btn color="primary" class="mt-4" to="/service/new">+ Create New Service</v-btn>
  </v-container>
</template>
