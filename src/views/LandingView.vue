<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useServicesStore } from '@/stores/services'
import { useUndoStore } from '@/stores/undo'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { usePeopleStore } from '@/stores/people'
import { useSongsStore } from '@/stores/songs'
import ServiceCard from '@/components/ServiceCard.vue'
import type { Service } from '@/models/service'
import { personDisplayName } from '@/models/library'

const store = useServicesStore()
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()
const peopleStore = usePeopleStore()
const songsStore = useSongsStore()
// Deletion is soft until the undo toast expires (spec section 16) — see SongLibraryView for
// the same pattern and its rationale.
const pendingDeleteIds = reactive(new Set<string>())

async function deleteService(service: Service) {
  if (!(await confirmDialog.confirm(`Delete the "${service.type} — ${service.date}" service?`, 'Delete'))) return
  pendingDeleteIds.add(service.id)
  undoStore.push(
    `Deleted "${service.type} — ${service.date}"`,
    () => pendingDeleteIds.delete(service.id),
    async () => {
      await store.remove(service.id)
      pendingDeleteIds.delete(service.id)
      // Deleting a service silently updates any of its songs' usage stats on the backend (see
      // songs::recompute_usage) — refresh the shared songs store so that shows up immediately.
      await songsStore.load()
    },
  )
}
onMounted(() => {
  if (!store.loaded) store.load()
  if (!peopleStore.loaded) peopleStore.load()
})

function preacherName(service: Service): string | undefined {
  const person = peopleStore.people.find((p) => p.id === service.preacherId)
  return person ? personDisplayName(person) : undefined
}

const tab = ref<'home' | 'browse'>('home')
const browseQuery = ref('')

const todayIso = () => new Date().toISOString().slice(0, 10)

const visibleServices = computed(() => store.services.filter((service) => !pendingDeleteIds.has(service.id)))

const todayService = computed(() => visibleServices.value.find((service) => service.date === todayIso()))

const upcomingServices = computed(() =>
  visibleServices.value
    .filter((service) => service.date > todayIso())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5),
)

const pastServices = computed(() =>
  visibleServices.value.filter((service) => service.date < todayIso()).sort((a, b) => b.date.localeCompare(a.date)),
)

const browseResults = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which is what silently broke the clear button.
  const query = (browseQuery.value ?? '').trim().toLowerCase()
  if (!query) return pastServices.value.slice(0, 10)
  return visibleServices.value.filter((service) =>
    [service.type, service.sermonTitle, preacherName(service), service.keyPassage].some((field) =>
      field?.toLowerCase().includes(query),
    ),
  )
})
</script>

<template>
  <v-container class="py-8" style="max-width: 720px">
    <div class="text-center mb-6">
      <p class="text-medium-emphasis">Select a service to continue, or create a new one</p>
    </div>

    <v-tabs v-model="tab" class="mb-6">
      <v-tab value="home">Home</v-tab>
      <v-tab value="browse">Browse</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="home" class="pt-2">
        <template v-if="todayService">
          <div class="text-overline text-medium-emphasis mb-2">Today</div>
          <ServiceCard
            :service="todayService"
            :preacher-name="preacherName(todayService)"
            badge="TODAY"
            @delete="deleteService(todayService)"
          />
        </template>

        <div class="d-flex align-center justify-space-between mt-6 mb-2">
          <div class="text-overline text-medium-emphasis">Upcoming</div>
          <v-btn variant="flat" color="primary" prepend-icon="mdi-calendar-month-outline" to="/planning-ahead">
            Planning Ahead
          </v-btn>
        </div>
        <ServiceCard
          v-for="service in upcomingServices"
          :key="service.id"
          :service="service"
          :preacher-name="preacherName(service)"
          @delete="deleteService(service)"
        />
        <p v-if="upcomingServices.length === 0" class="text-medium-emphasis text-body-2">No upcoming services yet.</p>

        <v-btn variant="flat" color="primary" size="large" block class="mt-6" prepend-icon="mdi-plus" to="/create-service">
          Create New Service
        </v-btn>
      </v-window-item>

      <v-window-item value="browse" class="pt-2">
        <v-text-field
          v-model="browseQuery"
          prepend-inner-icon="mdi-magnify"
          label="Search all services…"
          variant="outlined"
          density="comfortable"
          class="mb-6"
          clearable
        />
        <div class="text-overline text-medium-emphasis mb-2">{{ browseQuery ? 'Results' : 'Recent' }}</div>
        <ServiceCard
          v-for="service in browseResults"
          :key="service.id"
          :service="service"
          :preacher-name="preacherName(service)"
          @delete="deleteService(service)"
        />
        <p v-if="browseResults.length === 0" class="text-medium-emphasis text-body-2">No services found.</p>
      </v-window-item>
    </v-window>
  </v-container>
</template>
