<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { useServicesStore } from '@/stores/services'
import { useSongsStore } from '@/stores/songs'
import { flattenService, type FlatSlide } from '@/utils/flattenService'
import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'

const route = useRoute()
const servicesStore = useServicesStore()
const songsStore = useSongsStore()

const service = ref<Service>()
const selectedItemIndex = ref(0)
/** -1 = nothing live yet; equal to flatSlides.length = live but past the last slide (blank). */
const flatIndex = ref(-1)
const isPresenting = ref(false)

const addDialogOpen = ref(false)
const addQuery = ref('')

onMounted(async () => {
  if (!songsStore.loaded) await songsStore.load()
  service.value = await getAdapter().services.get(route.params.id as string)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const songsById = computed(() => new Map(songsStore.songs.map((song) => [song.id, song])))
const flatSlides = computed<FlatSlide[]>(() => (service.value ? flattenService(service.value, songsById.value) : []))

const selectedItem = computed<ServiceItem | undefined>(() => service.value?.items[selectedItemIndex.value])
const selectedSong = computed<Song | undefined>(() => {
  const item = selectedItem.value
  return item?.type === 'song' ? songsById.value.get(item.songId) : undefined
})

function itemIcon(item: ServiceItem): string {
  switch (item.type) {
    case 'song':
      return 'mdi-music-note'
    case 'scripture':
      return 'mdi-book-open-page-variant'
    case 'text-slide':
    case 'slide-ref':
      return 'mdi-file-document-outline'
    case 'media':
      return 'mdi-image'
    case 'video':
      return 'mdi-movie-open'
    case 'audio':
      return 'mdi-volume-high'
    case 'external-app':
      return 'mdi-application'
    case 'countdown':
      return 'mdi-timer-outline'
    case 'qr':
      return 'mdi-qrcode'
    default:
      return 'mdi-file'
  }
}

function itemLabel(item: ServiceItem): string {
  if (item.type === 'song') return songsById.value.get(item.songId)?.title ?? 'Unknown Song'
  if (item.type === 'scripture') return item.reference
  if (item.type === 'text-slide') return 'Text Slide'
  return item.type
}

function itemHasLive(index: number): boolean {
  const slide = flatSlides.value[flatIndex.value]
  return !!slide && slide.itemIndex === index
}

async function persist() {
  if (service.value) await servicesStore.save(service.value)
}

// In-workspace arrangement editing — edits only this service item's own copy of the
// arrangement (spec section 3), never the library song's defaultArrangement.
function removeFromArrangement(index: number) {
  const item = selectedItem.value
  if (item?.type !== 'song') return
  item.arrangement.sequence.splice(index, 1)
  persist()
}
function addToArrangement(blockId: string) {
  const item = selectedItem.value
  if (item?.type !== 'song') return
  item.arrangement.sequence.push(blockId)
  persist()
}
function resetArrangementToDefault() {
  const item = selectedItem.value
  const song = selectedSong.value
  if (item?.type !== 'song' || !song) return
  item.arrangement.sequence = [...song.defaultArrangement.sequence]
  persist()
}

// Live transport — flattened Next/Prev across the whole service (spec section 3).
function describeSlide(index: number): string {
  const slide = flatSlides.value[index]
  if (slide) return `${slide.itemLabel} — ${slide.subLabel}`
  return flatSlides.value.length === 0 ? 'Service is empty' : 'End of service'
}
const nextIndex = computed(() => (flatIndex.value === -1 ? 0 : Math.min(flatIndex.value + 1, flatSlides.value.length)))
const prevIndex = computed(() => Math.max(flatIndex.value - 1, 0))
const nextPreviewLabel = computed(() => describeSlide(nextIndex.value))
const prevPreviewLabel = computed(() => describeSlide(prevIndex.value))

function goLive(index: number) {
  flatIndex.value = index
}
function next() {
  flatIndex.value = nextIndex.value
}
function previous() {
  flatIndex.value = prevIndex.value
}
function togglePresenting() {
  isPresenting.value = !isPresenting.value
  if (isPresenting.value) {
    if (flatIndex.value === -1 && flatSlides.value.length > 0) flatIndex.value = 0
    getAdapter().live.startPresenting()
  } else {
    getAdapter().live.stopPresenting()
  }
}

const liveSlide = computed(() =>
  flatIndex.value >= 0 && flatIndex.value < flatSlides.value.length ? flatSlides.value[flatIndex.value] : undefined,
)
const liveStatusText = computed(() => {
  if (!isPresenting.value) return 'Not Presenting'
  if (!liveSlide.value) return 'LIVE: Blank'
  return `LIVE: ${liveSlide.value.itemLabel} — ${liveSlide.value.subLabel}`
})
const liveContextSnippet = computed(() => {
  const firstLine = liveSlide.value?.text.split('\n')[0]
  return firstLine ? `"${firstLine}"` : ''
})

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
  if (!service.value) return
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      selectedItemIndex.value = Math.max(0, selectedItemIndex.value - 1)
      break
    case 'ArrowDown':
      event.preventDefault()
      selectedItemIndex.value = Math.min(service.value.items.length - 1, selectedItemIndex.value + 1)
      break
    case 'ArrowLeft':
      event.preventDefault()
      previous()
      break
    case 'ArrowRight':
      event.preventDefault()
      next()
      break
  }
}

// Minimal "+ Add to Service" — just enough to add a song for now. The full picker (search
// across songs/scripture/slides/media, scripture sub-picker) is spec section 2's own
// feature, scoped separately from this milestone.
const filteredSongsForAdd = computed(() => {
  const q = addQuery.value.trim().toLowerCase()
  return songsStore.songs.filter((song) => !q || song.title.toLowerCase().includes(q))
})
async function addSongToService(song: Song) {
  if (!service.value) return
  const item: ServiceItem = {
    id: `item-${crypto.randomUUID()}`,
    type: 'song',
    songId: song.id,
    arrangement: { sequence: [...song.defaultArrangement.sequence] },
  }
  service.value.items.push(item)
  await persist()
  selectedItemIndex.value = service.value.items.length - 1
  addDialogOpen.value = false
  addQuery.value = ''
}

function updatePresenterNote(itemId: string, note: string) {
  if (!service.value) return
  if (!service.value.presenterNotes) service.value.presenterNotes = {}
  service.value.presenterNotes[itemId] = note
  persist()
}
</script>

<template>
  <div v-if="service">
    <v-toolbar density="compact" elevation="0" class="border-b px-2">
      <v-btn variant="text" prepend-icon="mdi-chevron-left" to="/">Home</v-btn>
      <div class="d-flex flex-column ml-3" style="line-height: 1.2">
        <span class="text-body-2 font-weight-bold">{{ service.type }} — {{ service.date }}</span>
        <span class="text-caption text-medium-emphasis">{{ service.sermonTitle }}</span>
      </div>
    </v-toolbar>

    <div class="workspace-layout">
      <div class="service-panel">
        <div class="text-overline text-medium-emphasis px-3 py-2 border-b">Service Order</div>
        <div class="flex-grow-1 overflow-y-auto pa-2">
          <div
            v-for="(item, index) in service.items"
            :key="item.id"
            class="service-item"
            :class="{ 'service-item--selected': index === selectedItemIndex, 'service-item--live': itemHasLive(index) }"
            @click="selectedItemIndex = index"
          >
            <v-icon :icon="itemIcon(item)" size="small" />
            <span class="text-truncate">{{ itemLabel(item) }}</span>
          </div>
        </div>
        <v-btn variant="text" prepend-icon="mdi-plus" class="ma-2" @click="addDialogOpen = true">Add to Service</v-btn>
      </div>

      <div class="center-panel">
        <template v-if="selectedItem">
          <div class="mb-3">
            <h2 class="text-h6">{{ itemLabel(selectedItem) }}</h2>
            <p class="text-caption text-medium-emphasis">
              Click a slide to make it live · Next/Prev moves through the whole service
            </p>
          </div>

          <template v-if="selectedItem.type === 'song' && selectedSong">
            <VueDraggable
              v-model="selectedItem.arrangement.sequence"
              handle=".drag-handle"
              :animation="150"
              class="d-flex flex-column ga-1"
              style="max-width: 460px"
              @end="persist"
            >
              <div
                v-for="(blockId, index) in selectedItem.arrangement.sequence"
                :key="index"
                class="slide-row"
                :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) && flatIndex === index }"
                @click="goLive(index)"
              >
                <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
                <div class="flex-grow-1" style="min-width: 0">
                  <div class="text-body-2 font-weight-bold">
                    {{ selectedSong.blocks.find((b) => b.id === blockId)?.label ?? blockId }}
                  </div>
                  <div class="text-body-2" style="white-space: pre-line; opacity: 0.75">
                    {{ selectedSong.blocks.find((b) => b.id === blockId)?.text }}
                  </div>
                </div>
                <v-btn
                  icon="mdi-close"
                  variant="text"
                  density="compact"
                  size="x-small"
                  class="row-remove"
                  @click.stop="removeFromArrangement(index)"
                />
              </div>
            </VueDraggable>

            <div class="d-flex flex-wrap align-center ga-2 mt-3" style="max-width: 460px">
              <span class="text-caption font-weight-bold text-medium-emphasis mr-1">Add:</span>
              <v-chip
                v-for="block in selectedSong.blocks"
                :key="block.id"
                variant="outlined"
                color="primary"
                size="small"
                class="cursor-pointer"
                @click="addToArrangement(block.id)"
              >
                {{ block.label }}
              </v-chip>
              <v-btn variant="text" size="small" class="text-medium-emphasis" @click="resetArrangementToDefault">
                Reset to song default
              </v-btn>
            </div>
          </template>

          <template v-else>
            <div
              class="slide-row"
              :class="{ 'slide-row--live': itemHasLive(selectedItemIndex) }"
              style="max-width: 460px"
              @click="goLive(flatSlides.findIndex((s) => s.itemIndex === selectedItemIndex))"
            >
              <div class="text-body-2">Click to make this item live.</div>
            </div>
          </template>

          <div class="mt-6" style="max-width: 460px">
            <div class="text-overline text-medium-emphasis mb-2">Presenter Notes</div>
            <v-textarea
              :model-value="service.presenterNotes?.[selectedItem.id]"
              variant="outlined"
              density="compact"
              rows="2"
              placeholder="Notes visible only on operator screen…"
              @update:model-value="(value: string) => updatePresenterNote(selectedItem!.id, value)"
            />
          </div>
        </template>
        <p v-else class="text-medium-emphasis">This service has no items yet.</p>
      </div>
    </div>

    <div class="live-footer">
      <v-btn :color="isPresenting ? 'error' : 'primary'" variant="flat" @click="togglePresenting">
        <v-icon :icon="isPresenting ? 'mdi-stop' : 'mdi-play'" start />
        {{ isPresenting ? 'Stop Presenting' : 'Start Presenting' }}
      </v-btn>

      <div class="live-status" :class="{ 'text-error': isPresenting }">
        <span v-if="isPresenting" class="live-blink" />
        <span class="font-weight-bold">{{ liveStatusText }}</span>
        <span class="text-medium-emphasis text-truncate">{{ liveContextSnippet }}</span>
      </div>

      <div class="d-flex ga-3">
        <div class="d-flex flex-column align-center">
          <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 140px">{{ prevPreviewLabel }}</span>
          <v-btn variant="outlined" color="error" size="small" prepend-icon="mdi-chevron-left" @click="previous">
            Previous
          </v-btn>
        </div>
        <div class="d-flex flex-column align-center">
          <span class="text-caption text-medium-emphasis text-truncate" style="max-width: 140px">{{ nextPreviewLabel }}</span>
          <v-btn variant="outlined" color="error" size="small" append-icon="mdi-chevron-right" @click="next">Next</v-btn>
        </div>
      </div>
    </div>

    <v-dialog v-model="addDialogOpen" max-width="480">
      <v-card>
        <v-card-title>Add to Service</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="addQuery"
            label="Search songs…"
            variant="outlined"
            density="comfortable"
            prepend-inner-icon="mdi-magnify"
            autofocus
          />
          <v-list>
            <v-list-item
              v-for="song in filteredSongsForAdd"
              :key="song.id"
              :title="song.title"
              :subtitle="song.author"
              @click="addSongToService(song)"
            />
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="addDialogOpen = false">Cancel</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Service not found.</p>
  </v-container>
</template>

<style scoped>
.workspace-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  align-items: start;
}
.service-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: calc(100vh - 105px);
}
.service-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  margin-bottom: 2px;
}
.service-item:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.service-item--selected {
  background: rgba(var(--v-theme-primary), 0.12);
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.service-item--live {
  border-left: 3px solid rgb(var(--v-theme-error));
  padding-left: 7px;
}
.center-panel {
  padding: 20px 24px;
}
.slide-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.slide-row:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.slide-row--live {
  background: rgba(var(--v-theme-error), 0.1);
  border-left: 3px solid rgb(var(--v-theme-error));
  padding-left: 9px;
}
.row-remove {
  opacity: 0;
}
.slide-row:hover .row-remove {
  opacity: 1;
}
.live-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.live-status {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
}
.live-blink {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  flex-shrink: 0;
}
</style>
