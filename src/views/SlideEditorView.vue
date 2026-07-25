<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { useSlidesStore } from '@/stores/slides'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useUndoStore } from '@/stores/undo'
import type { SlideLibraryItem } from '@/models/library'

const route = useRoute()
const router = useRouter()
const store = useSlidesStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const undoStore = useUndoStore()

const item = ref<SlideLibraryItem>()

// "New Slide" (SlideLibraryView) navigates straight here with id "new" rather than saving a
// blank file first — nothing is written to disk until Save is pressed, so backing out
// without saving leaves no trace.
function blankItem(): SlideLibraryItem {
  return {
    id: `slide-${crypto.randomUUID()}`,
    label: 'New Slide',
    slides: [],
    usage: { usesPastYear: 0 },
    updatedAt: '',
    updatedByDevice: '',
  }
}

onMounted(async () => {
  const isNew = route.params.id === 'new'
  item.value = isNew ? blankItem() : await getAdapter().slides.get(route.params.id as string)
  // A freshly created item is inherently unsaved — starting dirty (rather than false, as
  // for an existing item) enables the Save button and the router guard's
  // leave-without-saving warning immediately, so it's never silently lost with no way to
  // recover it.
  isDirty.value = isNew
  // Registered after the initial load so it only reacts to actual user edits, not the
  // assignment above — a single deep watch instead of wiring a dirty-flag handler onto
  // every field individually.
  watch(item, () => (isDirty.value = true), { deep: true })
  // The Save button itself lives in the persistent app bar (App.vue), not a per-page
  // toolbar that would scroll out of view — this view just supplies the action.
  saveHandler.value = saveItem
})

onUnmounted(() => {
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveItem() {
  if (!item.value || saving.value) return
  saving.value = true
  try {
    await store.save(item.value)
    isDirty.value = false
    // First save of a new item — swap the placeholder URL for the real id so refresh and
    // any subsequent save target the actual persisted item.
    if (route.params.id === 'new') await router.replace(`/library/slides/${item.value.id}`)
  } finally {
    saving.value = false
  }
}

const usageLabel = computed(() => {
  if (!item.value) return ''
  const { lastUsedAt, usesPastYear } = item.value.usage
  if (usesPastYear === 0) return 'Not yet used'
  const last = lastUsedAt ? new Date(lastUsedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : undefined
  return last ? `Last used ${last} · used ${usesPastYear}x this year` : `Used ${usesPastYear}x this year`
})

function addSlide() {
  item.value?.slides.push({ id: `slide-part-${crypto.randomUUID()}`, label: `Slide ${(item.value.slides.length ?? 0) + 1}`, text: '' })
}
function removeSlide(index: number) {
  if (!item.value) return
  const [removed] = item.value.slides.splice(index, 1)
  if (!removed) return
  undoStore.push(`Removed "${removed.label}"`, () => item.value?.slides.splice(index, 0, removed))
}

const loopEnabled = computed({
  get: () => item.value?.loop?.enabled ?? false,
  set: (enabled: boolean) => {
    if (!item.value) return
    if (enabled) {
      item.value.loop = { enabled: true, secondsPerSlide: item.value.loop?.secondsPerSlide ?? 8 }
    } else {
      item.value.loop = undefined
    }
  },
})
</script>

<template>
  <div v-if="item">
    <div class="editor-panel">
      <v-text-field
        v-model="item.label"
        variant="filled"
        density="compact"
        rounded="lg"
        class="text-h5 font-weight-bold mb-1 slide-title-field"
        hide-details
      />
      <p class="text-caption text-medium-emphasis mb-6">{{ usageLabel }}</p>

      <div class="text-overline text-medium-emphasis mb-2">Auto-Loop Playback</div>
      <p class="text-caption text-medium-emphasis mb-2">
        Cycles through this item's slides automatically while live — useful for pre-service gathering time.
      </p>
      <div class="d-flex align-center ga-4 mb-6">
        <v-switch v-model="loopEnabled" label="Loop automatically" color="primary" hide-details density="compact" />
        <v-text-field
          v-if="loopEnabled && item.loop"
          v-model.number="item.loop.secondsPerSlide"
          type="number"
          min="1"
          label="Seconds per slide"
          variant="outlined"
          density="compact"
          style="width: 170px"
          hide-details
        />
      </div>

      <div class="text-overline text-medium-emphasis mb-2">Slides</div>
      <VueDraggable v-model="item.slides" handle=".drag-handle" :animation="150" class="d-flex flex-column ga-3">
        <v-card v-for="(slide, index) in item.slides" :key="slide.id" variant="outlined" rounded="lg" class="slide-card">
          <div class="d-flex align-center ga-2 px-3 py-2 border-b slide-card-header">
            <v-icon icon="mdi-drag-vertical" class="drag-handle" style="cursor: grab" />
            <v-text-field
              v-model="slide.label"
              variant="filled"
              density="compact"
              rounded="lg"
              hide-details
              class="font-weight-bold flex-grow-1 slide-label-field"
            />
            <v-btn variant="flat" color="error" prepend-icon="mdi-trash-can-outline" @click="removeSlide(index)">
              Remove
            </v-btn>
          </div>
          <v-textarea
            v-model="slide.text"
            variant="filled"
            density="compact"
            rows="3"
            auto-grow
            hide-details
            class="px-3 py-2 slide-text-field"
          />
        </v-card>
      </VueDraggable>
      <v-btn variant="flat" color="primary" class="mt-3" prepend-icon="mdi-plus" @click="addSlide">Add Slide</v-btn>
    </div>
  </div>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Slide not found.</p>
  </v-container>
</template>

<style scoped>
.editor-panel {
  max-width: 720px;
  padding: 24px 32px;
}
.slide-card-header {
  background: rgba(var(--v-theme-amber), 0.12);
}
.slide-label-field :deep(.v-field__input) {
  color: rgb(var(--v-theme-amber));
}
.slide-label-field :deep(.v-field) {
  background: rgba(var(--v-theme-amber), 0.3);
  border: 1px solid rgba(var(--v-theme-amber), 0.6);
}
.slide-label-field :deep(.v-field__overlay) {
  opacity: 0;
}
.slide-label-field :deep(.v-field__outline),
.slide-title-field :deep(.v-field__outline) {
  display: none;
}
.slide-label-field :deep(.v-field--focused) {
  border-width: 2px;
  border-color: rgb(var(--v-theme-amber));
}

.slide-text-field :deep(.v-field) {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.slide-text-field :deep(.v-field__overlay) {
  opacity: 0;
}
.slide-text-field :deep(.v-field__outline) {
  display: none;
}
.slide-text-field :deep(.v-field--focused) {
  border-width: 2px;
  border-color: rgb(var(--v-theme-amber));
}

.slide-title-field :deep(.v-field) {
  background: rgba(var(--v-theme-amber), 0.3);
  border: 1px solid rgba(var(--v-theme-amber), 0.6);
}
.slide-title-field :deep(.v-field__overlay) {
  opacity: 0;
}
.slide-title-field :deep(.v-field--focused) {
  border-width: 2px;
  border-color: rgb(var(--v-theme-amber));
}
</style>
