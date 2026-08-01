<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { useMediaStore } from '@/stores/media'
import ImportMediaDialog from '@/components/media/ImportMediaDialog.vue'

const props = withDefaults(defineProps<{ purpose?: 'slide' | 'logo' | 'background' }>(), {
  purpose: 'slide',
})

const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  select: [mediaId: string, placement: 'element' | 'background']
}>()

const store = useMediaStore()
const query = ref('')
const activeTag = ref<string>()
const importDialogOpen = ref(false)
const previewUrlById = reactive(new Map<string, string>())

const mediaItems = computed(() =>
  store.items.filter(
    (item) =>
      (props.purpose === 'background' ? true : item.kind === 'image') &&
      (props.purpose === 'slide' || item.location === 'synced'),
  ),
)
const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of mediaItems.value) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})
const filteredItems = computed(() => {
  const search = (query.value ?? '').trim().toLowerCase()
  return mediaItems.value
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
  () => mediaItems.value.map((item) => item.id),
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

const pickerTitle = computed(() => {
  if (props.purpose === 'logo') return 'Choose a Logo'
  if (props.purpose === 'background') return 'Choose a Background'
  return 'Choose an Image'
})
const pickerDescription = computed(() => {
  if (props.purpose === 'logo') return 'Select a synced image or import a new logo.'
  if (props.purpose === 'background')
    return 'Select a synced image or video so the theme works on every library computer.'
  return 'Select an image already in the library or import a new one.'
})
const itemNoun = computed(() => (props.purpose === 'background' ? 'media item' : 'image'))
</script>

<template>
  <v-dialog v-model="open" max-width="1100">
    <v-card class="media-picker-card" :class="{ 'media-picker-card--logo': purpose === 'logo' }">
      <header class="picker-header">
        <div>
          <span>{{ purpose === 'logo' ? 'Branding' : 'Media Library' }}</span>
          <h2>{{ pickerTitle }}</h2>
          <p>{{ pickerDescription }}</p>
        </div>
        <div class="picker-header-actions">
          <v-btn
            prepend-icon="mdi-plus"
            color="primary"
            variant="flat"
            size="small"
            @click="importDialogOpen = true"
          >
            {{ purpose === 'logo' ? 'Import Logo' : 'Import Media' }}
          </v-btn>
          <v-btn prepend-icon="mdi-close" variant="text" size="small" @click="open = false">
            Close
          </v-btn>
        </div>
      </header>
      <v-card-text class="picker-body">
        <div class="picker-toolbar">
          <v-text-field
            v-model="query"
            prepend-inner-icon="mdi-magnify"
            :label="purpose === 'background' ? 'Search backgrounds' : 'Search images'"
            variant="outlined"
            density="compact"
            hide-details
            clearable
          />
          <span
            >{{ filteredItems.length }} {{ itemNoun
            }}{{ filteredItems.length === 1 ? '' : 's' }}</span
          >
        </div>

        <div class="media-browser">
          <aside class="tag-sidebar">
            <div class="tag-heading">Filter by tag</div>
            <v-list density="compact" nav class="pa-0">
              <v-list-item :active="!activeTag" rounded="lg" @click="activeTag = undefined">
                {{ purpose === 'background' ? 'All Backgrounds' : 'All Images' }}
                <template #append>
                  <span class="text-caption text-medium-emphasis">{{ mediaItems.length }}</span>
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
            <article v-for="item in filteredItems" :key="item.id" class="media-card">
              <div class="media-thumb">
                <img
                  v-if="previewUrlById.has(item.id) && item.kind === 'image'"
                  :src="previewUrlById.get(item.id)"
                  alt=""
                />
                <video
                  v-else-if="previewUrlById.has(item.id)"
                  :src="previewUrlById.get(item.id)"
                  muted
                  preload="metadata"
                />
                <v-icon v-else icon="mdi-image-outline" size="32" />
                <v-chip
                  v-if="item.kind === 'video'"
                  size="x-small"
                  class="kind-badge"
                  variant="flat"
                  prepend-icon="mdi-video-outline"
                >
                  VIDEO
                </v-chip>
                <v-chip
                  v-if="item.location === 'local'"
                  size="x-small"
                  color="warning"
                  class="location-badge"
                  variant="flat"
                >
                  LOCAL
                </v-chip>
              </div>
              <div class="media-card-copy">
                <strong :title="item.title">{{ item.title }}</strong>
                <span :title="item.filename">{{ item.filename }}</span>
                <small :title="item.tags.join(', ')">{{
                  item.tags.join(', ') || 'Untagged'
                }}</small>
              </div>
              <footer class="media-card-actions">
                <v-btn
                  size="small"
                  color="primary"
                  variant="flat"
                  @click="choose(item.id, purpose === 'background' ? 'background' : 'element')"
                >
                  {{
                    purpose === 'logo'
                      ? 'Use as Logo'
                      : purpose === 'background'
                        ? 'Use as Background'
                        : 'Add to Slide'
                  }}
                </v-btn>
                <v-btn
                  v-if="purpose === 'slide'"
                  size="small"
                  variant="text"
                  @click="choose(item.id, 'background')"
                  >Background</v-btn
                >
              </footer>
            </article>
            <div v-if="filteredItems.length === 0" class="picker-empty">
              <v-icon icon="mdi-image-search-outline" size="30" />
              <strong>No {{ purpose === 'background' ? 'backgrounds' : 'images' }} found</strong>
              <span>Try another search or import new media.</span>
            </div>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <ImportMediaDialog
      v-model="importDialogOpen"
      :synced-only="purpose !== 'slide'"
      @imported="store.load()"
    />
  </v-dialog>
</template>

<style scoped>
.media-picker-card {
  overflow: hidden;
  max-height: 88vh;
}
.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 19px 22px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-background), 0.25);
}
.picker-header > div:first-child > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.65rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.picker-header h2 {
  margin: 2px 0 0;
  font-size: 1.05rem;
}
.picker-header p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.71rem;
}
.picker-header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}
.picker-header-actions :deep(.v-btn) {
  font-size: 0.7rem;
}
.picker-body {
  padding: 18px 20px 20px !important;
  overflow: hidden;
}
.picker-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.picker-toolbar .v-text-field {
  width: min(360px, 100%);
  flex: 0 1 360px;
}
.picker-toolbar > span {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.69rem;
}
.media-browser {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 18px;
}
.tag-sidebar {
  min-width: 0;
  padding-right: 14px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.tag-heading {
  margin: 1px 8px 8px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.media-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  grid-auto-rows: max-content;
  align-items: start;
  gap: 13px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 1px 5px 5px 1px;
}
.media-card {
  display: flex;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.7);
}
.media-thumb {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background-color: rgba(var(--v-theme-on-surface), 0.045);
  background-image:
    linear-gradient(45deg, rgba(var(--v-theme-on-surface), 0.045) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(var(--v-theme-on-surface), 0.045) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(var(--v-theme-on-surface), 0.045) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(var(--v-theme-on-surface), 0.045) 75%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
}
.media-thumb img,
.media-thumb video {
  display: block;
  width: auto;
  max-width: calc(100% - 14px);
  height: auto;
  max-height: calc(100% - 14px);
  object-fit: contain;
}
.media-picker-card--logo .media-thumb {
  aspect-ratio: 1;
}
.media-card-copy {
  min-width: 0;
  min-height: 77px;
  padding: 11px 12px 8px;
}
.media-card-copy strong,
.media-card-copy span,
.media-card-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-card-copy strong {
  font-size: 0.76rem;
}
.media-card-copy span,
.media-card-copy small {
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.66rem;
}
.media-card-actions {
  display: flex;
  min-height: 49px;
  align-items: center;
  gap: 3px;
  margin-top: auto;
  padding: 8px 10px 10px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.media-card-actions :deep(.v-btn) {
  font-size: 0.66rem;
}
.location-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
}
.kind-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: rgba(10, 14, 20, 0.82) !important;
  color: white !important;
}
.picker-empty {
  display: flex;
  min-height: 250px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-align: center;
}
.picker-empty strong {
  margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.76rem;
}
.picker-empty span {
  font-size: 0.68rem;
}
@media (max-width: 760px) {
  .picker-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .media-browser {
    grid-template-columns: 1fr;
  }
  .tag-sidebar {
    padding: 0 0 10px;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  }
  .tag-sidebar .v-list {
    display: flex;
    overflow-x: auto;
  }
}
</style>
