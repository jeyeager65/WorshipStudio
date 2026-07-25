<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import type { LibrarySettings } from '@/models/settings'
import type { Service } from '@/models/service'

const router = useRouter()
const store = useServicesStore()

const date = ref(new Date().toISOString().slice(0, 10))
const type = ref('')
const sermonTitle = ref('')
const keyPassage = ref('')
const preacher = ref('')
const saving = ref(false)

const librarySettings = ref<LibrarySettings>()

onMounted(async () => {
  librarySettings.value = await getAdapter().settings.getLibrarySettings()
  if (librarySettings.value.serviceTypes.length > 0) {
    type.value = librarySettings.value.serviceTypes[0]
  }
})

async function createService() {
  if (saving.value) return
  saving.value = true
  try {
    const service: Service = {
      id: `service-${crypto.randomUUID()}`,
      date: date.value,
      type: type.value,
      preacher: preacher.value || undefined,
      sermonTitle: sermonTitle.value || undefined,
      keyPassage: keyPassage.value || undefined,
      items: [],
      updatedAt: '',
      updatedByDevice: '',
    }
    await store.save(service)
    await router.push(`/service/${service.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 560px">
    <v-btn variant="flat" color="secondary" class="mb-4" prepend-icon="mdi-chevron-left" to="/">
      Back to Home
    </v-btn>

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
          <v-select v-model="type" :items="librarySettings?.serviceTypes ?? []" label="Type" variant="outlined" />
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
          <v-combobox
            v-model="preacher"
            :items="librarySettings?.preachers ?? []"
            label="Preacher (optional)"
            placeholder="Start typing or pick from list"
            variant="outlined"
            hint="Managed in Settings"
            persistent-hint
          />
        </v-col>
      </v-row>

      <div class="d-flex ga-3 mt-2">
        <v-btn variant="flat" color="secondary" class="flex-grow-1" to="/">Cancel</v-btn>
        <v-btn variant="flat" color="primary" class="flex-grow-1" :loading="saving" :disabled="saving" @click="createService">
          Create &amp; Open Service →
        </v-btn>
      </div>
    </v-card>
  </v-container>
</template>
