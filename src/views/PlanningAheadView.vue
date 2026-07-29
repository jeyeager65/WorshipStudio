<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { groupUpcomingByMonth, hasStarted, needsPreacher } from '@/utils/planningAhead'
import { personDisplayName } from '@/models/library'
import type { Service } from '@/models/service'
import { findSermonItem, sermonPreacherId } from '@/utils/sermonInfo'

const store = useServicesStore()
const peopleStore = usePeopleStore()
const router = useRouter()

onMounted(() => {
  if (!store.loaded) store.load()
  if (!peopleStore.loaded) peopleStore.load()
})

function preacherName(service: Service): string | undefined {
  const person = peopleStore.people.find((p) => p.id === sermonPreacherId(service))
  return person ? personDisplayName(person) : undefined
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const months = computed(() => groupUpcomingByMonth(store.services, todayIso()))
const monthIndex = ref(0)
const currentMonth = computed(() => months.value[monthIndex.value])

function openService(serviceId: string) {
  router.push(`/service/${serviceId}`)
}
</script>

<template>
  <v-container class="py-8" style="max-width: 900px">
    <h1 class="text-h5 font-weight-bold mb-1">Planning Ahead</h1>
    <p class="text-medium-emphasis text-body-2 mb-6">
      A longer-range view of upcoming services — fill in a sermon title or preacher weeks ahead, without needing to
      build the full order yet.
    </p>

    <template v-if="months.length === 0">
      <p class="text-medium-emphasis text-body-2 mb-4">No upcoming services yet.</p>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" to="/create-service">Create New Service</v-btn>
    </template>

    <template v-else>
      <div class="d-flex align-center justify-space-between mb-4">
        <v-btn icon="mdi-chevron-left" variant="text" :disabled="monthIndex === 0" @click="monthIndex--" />
        <div class="text-h6">{{ currentMonth?.monthLabel }}</div>
        <v-btn icon="mdi-chevron-right" variant="text" :disabled="monthIndex >= months.length - 1" @click="monthIndex++" />
      </div>

      <v-table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Sermon Title</th>
            <th>Preacher</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="service in currentMonth?.services"
            :key="service.id"
            class="planning-row"
            @click="openService(service.id)"
          >
            <td class="font-weight-bold">
              {{ new Date(`${service.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}
            </td>
            <td>{{ service.type }}</td>
            <td>
              <span v-if="findSermonItem(service)?.title">{{ findSermonItem(service)?.title }}</span>
              <span v-else class="text-medium-emphasis font-italic">Not yet decided</span>
            </td>
            <td>
              <span v-if="!needsPreacher(service)">{{ preacherName(service) }}</span>
              <v-chip v-else color="warning" size="small" variant="tonal">Needs Preacher</v-chip>
            </td>
            <td>
              <v-chip :color="hasStarted(service) ? 'primary' : undefined" size="small" variant="tonal">
                {{ hasStarted(service) ? 'Started' : 'Not started' }}
              </v-chip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </v-container>
</template>

<style scoped>
.planning-row {
  cursor: pointer;
}
.planning-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
</style>
