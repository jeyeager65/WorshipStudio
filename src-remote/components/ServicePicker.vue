<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { formatServiceTime } from '@/utils/serviceTime'
import { useRemoteAction } from '../composables/useRemoteAction'

interface TodayServiceSummary {
  id: string
  date: string
  time?: string
  serviceType: string
}

const services = ref<TodayServiceSummary[]>()
const loadError = ref(false)
const { pending, sendAction } = useRemoteAction()

async function load() {
  try {
    const res = await fetch('/api/services/today')
    if (!res.ok) throw new Error('failed')
    services.value = (await res.json()) as TodayServiceSummary[]
    loadError.value = false
  } catch {
    loadError.value = true
  }
}

function select(id: string) {
  void sendAction('select-service', { serviceId: id })
}

onMounted(load)
</script>

<template>
  <div class="service-picker">
    <p class="heading">Today's Services</p>
    <p v-if="loadError" class="empty">Couldn't load today's services.</p>
    <p v-else-if="services && services.length === 0" class="empty">
      No services scheduled for today.
    </p>
    <button
      v-for="service in services"
      :key="service.id"
      type="button"
      class="service-row"
      :disabled="pending"
      @click="select(service.id)"
    >
      <span class="time">{{ formatServiceTime(service.time) ?? 'Time not set' }}</span>
      <span class="type">{{ service.serviceType }}</span>
    </button>
  </div>
</template>

<style scoped>
.service-picker {
  padding: var(--ws-space-3) var(--ws-space-4);
}
.heading {
  margin: 0 0 var(--ws-space-2);
  color: var(--ws-text-secondary);
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.empty {
  margin: 0;
  color: var(--ws-text-secondary);
  font-size: 0.85rem;
}
.service-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--ws-space-3);
  padding: var(--ws-space-3);
  margin-bottom: var(--ws-space-2);
  border: none;
  border-radius: var(--ws-radius-md);
  background: var(--ws-surface-variant);
  color: var(--ws-text);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.service-row:active:not(:disabled) {
  opacity: 0.8;
}
.time {
  color: var(--ws-primary);
}
</style>
