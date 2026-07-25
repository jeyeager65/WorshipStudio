<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSlidesStore } from '@/stores/slides'

const router = useRouter()
const store = useSlidesStore()

const query = ref('')

onMounted(() => {
  if (!store.loaded) store.load()
})

const filteredSlides = computed(() => {
  const q = query.value.trim().toLowerCase()
  const sorted = [...store.slides].sort((a, b) => a.label.localeCompare(b.label))
  if (!q) return sorted
  return sorted.filter((item) => item.label.toLowerCase().includes(q))
})

// The new item only exists in memory until the editor's Save button is used (see
// SlideEditorView) — creating it here immediately would leave a blank file on disk the
// moment this button is clicked, even if the user backs out without entering anything.
function createSlide() {
  router.push('/library/slides/new')
}
</script>

<template>
  <v-container class="py-8" style="max-width: 720px">
    <div class="d-flex align-center mb-6 ga-3">
      <h1 class="text-h5 font-weight-bold flex-grow-1">Slide Library</h1>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="createSlide">New Slide</v-btn>
    </div>

    <v-text-field
      v-model="query"
      prepend-inner-icon="mdi-magnify"
      label="Search slides…"
      variant="outlined"
      density="comfortable"
      class="mb-4"
      clearable
    />

    <v-list class="pa-0" bg-color="transparent">
      <v-list-item
        v-for="item in filteredSlides"
        :key="item.id"
        :to="`/library/slides/${item.id}`"
        :title="item.label"
        :subtitle="item.slides.length === 1 ? '1 slide' : `${item.slides.length} slides`"
        rounded="lg"
        class="border mb-2"
      >
        <template #append>
          <span class="text-caption text-medium-emphasis">{{ item.usage.usesPastYear }}x this year</span>
        </template>
      </v-list-item>
    </v-list>

    <p v-if="filteredSlides.length === 0" class="text-medium-emphasis text-body-2">No slides found.</p>
  </v-container>
</template>
