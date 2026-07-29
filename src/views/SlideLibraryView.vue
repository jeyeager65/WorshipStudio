<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSlidesStore } from '@/stores/slides'
import { useUndoStore } from '@/stores/undo'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { SlideLibraryItem } from '@/models/library'

const router = useRouter()
const store = useSlidesStore()
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()

const query = ref('')
// Deletion is soft until the undo toast expires (spec section 16) — see SongLibraryView for
// the same pattern and its rationale.
const pendingDeleteIds = reactive(new Set<string>())

onMounted(() => {
  if (!store.loaded) store.load()
})

const filteredSlides = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (query.value ?? '').trim().toLowerCase()
  const sorted = [...store.slides].filter((item) => !pendingDeleteIds.has(item.id)).sort((a, b) => a.label.localeCompare(b.label))
  if (!q) return sorted
  return sorted.filter((item) => item.label.toLowerCase().includes(q))
})

async function deleteSlide(item: SlideLibraryItem) {
  if (!(await confirmDialog.confirm(`Delete "${item.label}"?`, 'Delete'))) return
  pendingDeleteIds.add(item.id)
  undoStore.push(
    `Deleted "${item.label}"`,
    () => pendingDeleteIds.delete(item.id),
    async () => {
      await store.remove(item.id)
      pendingDeleteIds.delete(item.id)
    },
  )
}

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
      <v-spacer />
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
        class="border mb-2 slide-row-item"
      >
        <template #append>
          <span class="text-caption text-medium-emphasis mr-2">{{ item.usage.usesPastYear }}x this year</span>
          <v-btn
            icon="mdi-trash-can-outline"
            variant="flat"
            color="error"
            size="small"
            class="row-remove"
            @click.stop.prevent="deleteSlide(item)"
          />
        </template>
      </v-list-item>
    </v-list>

    <p v-if="filteredSlides.length === 0" class="text-medium-emphasis text-body-2">No slides found.</p>
  </v-container>
</template>

<style scoped>
.row-remove {
  opacity: 0;
}
.slide-row-item:hover .row-remove {
  opacity: 1;
}
</style>
