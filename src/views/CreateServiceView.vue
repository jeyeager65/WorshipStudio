<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useServicesStore } from '@/stores/services'
import { useSettingsStore } from '@/stores/settings'
import { usePeopleStore } from '@/stores/people'
import type { Service } from '@/models/service'
import { personDisplayName, sortByPreferredRole } from '@/models/library'
import { applyServiceTemplate } from '@/utils/serviceTemplate'
import { applySermonEdit, defaultSermonRole } from '@/utils/sermonInfo'

const router = useRouter()
const store = useServicesStore()
const settingsStore = useSettingsStore()
const peopleStore = usePeopleStore()

const date = ref(new Date().toISOString().slice(0, 10))
const type = ref('')
const sermonTitle = ref('')
const keyPassage = ref('')
const preacherId = ref<string>()

onMounted(async () => {
  await Promise.all([settingsStore.load(), peopleStore.load()])
  const serviceTypes = settingsStore.librarySettings?.serviceTypes ?? []
  if (serviceTypes.length > 0) type.value = serviceTypes[0]
})

const preacherOptions = computed(() =>
  sortByPreferredRole(peopleStore.people, 'Preacher').map((p) => ({ title: personDisplayName(p), value: p.id })),
)

// Seeds this service's items/assignments once from its type's Service Template (see Settings >
// Service Templates) — after creation the two are independent; editing the template later never
// touches an already-created service (see AssignmentsView/ServiceWorkspaceView, which only ever
// read their own service's items/assignments, never the template again).
function seedFromTemplate(): { items: Service['items']; assignments: Service['assignments'] } {
  const template = settingsStore.librarySettings?.serviceTemplates.find((t) => t.serviceType === type.value)
  if (!template) return { items: [], assignments: [] }
  return applyServiceTemplate(template)
}

// Handed to the workspace via the store rather than saved here — nothing is written to
// disk until its Save button is used, so backing out of a just-created service without
// saving leaves no trace (see ServiceWorkspaceView, which consumes and clears this).
function createService() {
  const { items, assignments } = seedFromTemplate()
  const service: Service = {
    id: `service-${crypto.randomUUID()}`,
    date: date.value,
    type: type.value,
    items,
    assignments,
    updatedAt: '',
    updatedByDevice: '',
  }
  // Only touch the sermon item at all if the operator actually entered something — many service
  // types (a members' meeting, e.g.) have no sermon, and shouldn't get one just because these
  // fields are always shown on this quick-create screen.
  if (sermonTitle.value || keyPassage.value || preacherId.value) {
    applySermonEdit(
      service,
      { title: sermonTitle.value, passageReference: keyPassage.value, preacherId: preacherId.value },
      defaultSermonRole(settingsStore.librarySettings?.serviceTemplates, type.value),
      settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
    )
  }
  store.draftService = service
  router.push(`/service/${service.id}`)
}
</script>

<template>
  <v-container class="py-8" style="max-width: 720px">
    <h1 class="text-h5 font-weight-bold mb-1">Create New Service</h1>
    <p class="text-medium-emphasis text-body-2 mb-6">
      Start with the basics — you'll add songs, scripture, and slides once inside the service.
    </p>

    <v-card variant="outlined" rounded="lg" class="pa-4">
      <v-row>
        <v-col cols="6">
          <v-text-field v-model="date" type="date" label="Date" variant="outlined" />
        </v-col>
        <v-col cols="6">
          <v-select v-model="type" :items="settingsStore.librarySettings?.serviceTypes ?? []" label="Type" variant="outlined" />
        </v-col>
      </v-row>

      <v-text-field
        v-model="sermonTitle"
        label="Sermon Title (optional)"
        placeholder="e.g. Our Lord's Prayer"
        variant="outlined"
      />

      <v-row>
        <v-col cols="6">
          <v-text-field
            v-model="keyPassage"
            label="Key Passage (optional)"
            placeholder="e.g. Matthew 6:9-13"
            variant="outlined"
            hint="Can be changed or added to later"
            persistent-hint
          />
        </v-col>
        <v-col cols="6">
          <v-select
            v-model="preacherId"
            :items="preacherOptions"
            label="Preacher (optional)"
            variant="outlined"
            clearable
            hint="Managed on the People page"
            persistent-hint
          />
        </v-col>
      </v-row>

      <div class="d-flex ga-3 mt-2">
        <v-btn variant="flat" color="secondary" class="flex-grow-1" to="/">Cancel</v-btn>
        <v-btn variant="flat" color="primary" class="flex-grow-1" @click="createService">Create &amp; Open Service →</v-btn>
      </div>
    </v-card>
  </v-container>
</template>
