<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { useMediaStore } from '@/stores/media'
import ImportMediaDialog from '@/components/media/ImportMediaDialog.vue'

const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  select: [mediaId: string, placement: 'element' | 'background']
}>()

const store = useMediaStore()
const query = ref('')
const activeTag = ref<string>()
const importDialogOpen = ref(false)
const previewUrlById = reactive(new Map<string, string>())

const images = computed(() => store.items.filter((item) => item.kind === 'image'))
const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of images.value) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})
const filteredItems = computed(() => {
  const search = (query.value ?? '').trim().toLowerCase()
  return images.value
    .filter((item) => !activeTag.value || item.tags.includes(activeTag.value))
    .filter(
      (item) =>
        !search ||
        item.title.toLowerCase().includes(search) ||
        item.filename.toLowerCase().includes(search) ||
        item.tags.some((tag) => tag.toLowerCase().includes(search)),
    )
    .sort((a, b) => a.title.localeCompare(b.title))
})

async function resolvePreview(id: string) {
  if (previewUrlById.has(id)) return
  const url = await getAdapter().media.getPreviewUrl(id)
  if (url) previewUrlById.set(id, url)
}

watch(
  () => images.value.map((item) => item.id),
  (ids) => ids.forEach(resolvePreview),
  { immediate: true },
)

watch(open, async (isOpen) => {
  if (isOpen && !store.loaded) await store.load()
})

function choose(mediaId: string, placement: 'element' | 'background') {
  emit('select', mediaId, placement)
  open.value = false
}
</script>

<template>
  <v-dialog v-model="open" max-width="1100">
    <v-card class="media-picker-card">
      <v-card-title class="d-flex align-center ga-3">
        Choose an image
        <v-spacer />
        <v-btn prepend-icon="mdi-plus" color="primary" variant="flat" @click="importDialogOpen = true">
          Import Media
        </v-btn>
        <v-btn icon="mdi-close" variant="text" @click="open = false" />
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="query"
          prepend-inner-icon="mdi-magnify"
          label="Search images…"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
          class="mb-4"
          style="max-width: 360px"
        />

        <div class="media-browser">
          <aside class="tag-sidebar">
            <div class="text-overline text-medium-emphasis mb-2">Tags</div>
            <v-list density="compact" nav class="pa-0">
              <v-list-item :active="!activeTag" rounded="lg" @click="activeTag = undefined">
                All Images
                <template #append>
                  <span class="text-caption text-medium-emphasis">{{ images.length }}</span>
                </template>
              </v-list-item>
              <v-list-item
                v-for="[tag, count] in tagCounts"
                :key="tag"
                :active="activeTag === tag"
                rounded="lg"
                @click="activeTag = tag"
              >
                {{ tag }}
                <template #append>
                  <span class="text-caption text-medium-emphasis">{{ count }}</span>
                </template>
              </v-list-item>
            </v-list>
          </aside>

          <div class="media-grid">
            <v-card v-for="item in filteredItems" :key="item.id" variant="outlined" class="media-card">
              <div class="media-thumb">
                <img v-if="previewUrlById.has(item.id)" :src="previewUrlById.get(item.id)" alt="" />
                <v-icon v-else icon="mdi-image-outline" size="32" />
                <v-chip v-if="item.location === 'local'" size="x-small" color="warning" class="location-badge" variant="flat">
                  LOCAL
                </v-chip>
              </div>
              <v-card-text class="pa-3">
                <div class="text-body-2 font-weight-bold text-truncate">{{ item.title }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ item.filename }}</div>
                <div class="text-caption text-medium-emphasis text-truncate">
                  {{ item.tags.join(', ') || 'Untagged' }}
                </div>
              </v-card-text>
              <v-card-actions class="pt-0">
                <v-btn size="small" color="primary" variant="flat" @click="choose(item.id, 'element')">
                  Add to slide
                </v-btn>
                <v-btn size="small" variant="text" @click="choose(item.id, 'background')">Background</v-btn>
              </v-card-actions>
            </v-card>
            <p v-if="filteredItems.length === 0" class="text-medium-emphasis text-body-2">No images found.</p>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <ImportMediaDialog v-model="importDialogOpen" @imported="store.load()" />
  </v-dialog>
</template>

<style scoped>
.media-picker-card {
  max-height: 88vh;
}
.media-browser {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 24px;
}
.tag-sidebar {
  min-width: 0;
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}
.media-card {
  align-self: start;
}
.media-thumb {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}
.media-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.location-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
}
</style>
