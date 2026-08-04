<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import ScriptureReferencePicker, {
  type ScriptureReferenceValue,
} from '@/components/ScriptureReferencePicker.vue'
import { getAdapter } from '@/adapters'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { useMediaStore } from '@/stores/media'
import { useExternalAppsStore } from '@/stores/externalApps'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { Service, ServiceItem, SermonPassage } from '@/models/service'
import type { Song, SongBlock } from '@/models/song'
import type { SlideLibraryItem, MediaItem } from '@/models/library'
import type { ScripturePassage, ScriptureTranslation } from '@/adapters/types'

// The Add Item menu (still owned by the parent's Service Order list section, at least until
// that's extracted too) chooses the item type before opening this dialog — every type's form
// lives here, sharing one dialog shell and reset path so selecting a type doesn't duplicate any
// add behavior or draft state.
export type AddItemType =
  | 'songs'
  | 'scripture'
  | 'slides'
  | 'media'
  | 'video'
  | 'external-app'
  | 'sermon'
  | 'bulletin-note'

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return fallback
}

const props = defineProps<{
  service: Service
  typeTitle: string
  initialTab: AddItemType
  // Set only while filling in a Service Template's placeholder — makes insertItem() splice the
  // new item into the placeholder's own slot instead of appending it, since there's no
  // reordering for the top-level item list today.
  replaceContext?: { index: number; role?: string; label?: string; note?: string }
  scriptureById: Map<string, ScripturePassage>
  scriptureTranslations: ScriptureTranslation[]
  resolveMediaItem: (mediaId: string) => Promise<void>
}>()

const open = defineModel<boolean>({ required: true })
const selectedItemIndex = defineModel<number>('selectedItemIndex', { required: true })
// Seeded from the church's configured default translation at app load (see
// ServiceWorkspaceView's onMounted) — ScriptureReferencePicker falls back to the first
// available translation itself if this is left unset.
const scriptureDraft = defineModel<ScriptureReferenceValue>('scriptureDraft', { required: true })

const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const mediaStore = useMediaStore()
const externalAppsStore = useExternalAppsStore()
const confirmDialog = useConfirmDialogStore()

const addTab = ref<AddItemType>(props.initialTab)
watch(open, (isOpen) => {
  if (isOpen) addTab.value = props.initialTab
})

const addQuery = ref('')

function insertItem(item: ServiceItem) {
  const svc = props.service
  const ctx = props.replaceContext
  if (ctx) {
    if (ctx.role && !item.role) item.role = ctx.role
    if (ctx.label && !item.bulletinLabel) item.bulletinLabel = ctx.label
    if (ctx.note && !item.bulletinNote) item.bulletinNote = ctx.note
    svc.items.splice(ctx.index, 1, item)
    // Deliberately NOT recomputed from length — it already points at the placeholder's slot,
    // which is exactly where the replacement now lives.
  } else {
    svc.items.push(item)
    selectedItemIndex.value = svc.items.length - 1
  }
}

const filteredSongsForAdd = computed(() => {
  const q = addQuery.value.trim().toLowerCase()
  return songsStore.songs.filter(
    (song) =>
      !song.archived &&
      (!q || [song.title, song.artist, song.author].some((field) => field?.toLowerCase().includes(q))),
  )
})
const addingSong = ref(false)
async function addSongToService(song: Song) {
  if (addingSong.value) return
  addingSong.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'song',
      songId: song.id,
      arrangement: { sequence: [...song.defaultArrangement.sequence] },
    }
    insertItem(item)
    closeAddDialog()
  } finally {
    addingSong.value = false
  }
}

// Scripture sub-picker (spec section 2) — the actual entry-mode/fields/display-mode/preview UI
// lives in ScriptureReferencePicker.vue (shared with the Sermon tab's passages list below,
// which needs several independent instances of the same picker); this is just the draft value
// plus the template ref used to read its exposed validity/resolved-passage on submit.
const scripturePickerRef = ref<InstanceType<typeof ScriptureReferencePicker>>()
const scripturePickerResetKey = ref(0)
const addingScripture = ref(false)

async function addScriptureToService() {
  const picker = scripturePickerRef.value
  if (!picker?.isValid || addingScripture.value) return
  if (
    scriptureDraft.value.displayMode === 'full' &&
    (!scriptureDraft.value.translation || picker.hasError)
  )
    return
  addingScripture.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'scripture',
      reference: scriptureDraft.value.reference,
      translation: scriptureDraft.value.translation,
      displayMode: scriptureDraft.value.displayMode,
    }
    insertItem(item)
    if (picker.resolvedPassage && scriptureDraft.value.displayMode === 'full')
      props.scriptureById.set(item.id, picker.resolvedPassage)
    closeAddDialog()
  } finally {
    addingScripture.value = false
  }
}

// Slides sub-picker (spec section 1/2): pick an existing library item (whole group
// inserted in order), or quick-create service-only text slides — same card-based
// label/text editing as the Slide Library editor, but the result belongs to this service
// only, never saved as a shared library entry (mirrors a song's per-service arrangement
// being separate from the library default).
const slidesSubMode = ref<'pick' | 'new'>('pick')
const slideQuery = ref('')
const addingSlideRef = ref(false)
const newTextSlideBlocks = ref<SongBlock[]>([])

const filteredSlidesForAdd = computed(() => {
  const q = slideQuery.value.trim().toLowerCase()
  return slidesStore.slides.filter(
    (item) =>
      !q ||
      item.label.toLowerCase().includes(q) ||
      (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
  )
})

async function addSlideRefToService(slideItem: SlideLibraryItem) {
  if (addingSlideRef.value) return
  addingSlideRef.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'slide-ref',
      slideId: slideItem.id,
    }
    insertItem(item)
    closeAddDialog()
  } finally {
    addingSlideRef.value = false
  }
}

function addNewTextSlideBlock() {
  newTextSlideBlocks.value.push({
    id: `slide-part-${crypto.randomUUID()}`,
    label: `Slide ${newTextSlideBlocks.value.length + 1}`,
    text: '',
  })
}
async function removeNewTextSlideBlock(index: number) {
  const target = newTextSlideBlocks.value[index]
  if (!target) return
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  newTextSlideBlocks.value.splice(index, 1)
}
function addTextSlideToService() {
  if (newTextSlideBlocks.value.length === 0) return
  const item: ServiceItem = {
    id: `item-${crypto.randomUUID()}`,
    type: 'text-slide',
    slides: newTextSlideBlocks.value.map((block) => ({ ...block })),
  }
  insertItem(item)
  closeAddDialog()
}

// Media/Video sub-pickers (spec section 3): pick an existing Media Library item, filtered by
// kind — 'image' backs the `media` item type (with a Cover/Contain fit choice, defaulting to
// Cover per the live-presentation aspect-ratio spec), 'video' backs the `video` item type.
const mediaQuery = ref('')
const videoQuery = ref('')
const mediaFit = ref<'cover' | 'contain'>('cover')
const addingMedia = ref(false)

const filteredMediaForAdd = computed(() => {
  const q = mediaQuery.value.trim().toLowerCase()
  return mediaStore.items.filter(
    (item) => item.kind === 'image' && (!q || item.filename.toLowerCase().includes(q)),
  )
})
const filteredVideoForAdd = computed(() => {
  const q = videoQuery.value.trim().toLowerCase()
  return mediaStore.items.filter(
    (item) => item.kind === 'video' && (!q || item.filename.toLowerCase().includes(q)),
  )
})

async function addMediaToService(mediaItem: MediaItem) {
  if (addingMedia.value) return
  addingMedia.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'media',
      mediaId: mediaItem.id,
      fit: mediaFit.value,
    }
    insertItem(item)
    closeAddDialog()
    await props.resolveMediaItem(mediaItem.id)
  } finally {
    addingMedia.value = false
  }
}
async function addVideoToService(mediaItem: MediaItem) {
  if (addingMedia.value) return
  addingMedia.value = true
  try {
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'video',
      mediaId: mediaItem.id,
    }
    insertItem(item)
    closeAddDialog()
    await props.resolveMediaItem(mediaItem.id)
  } finally {
    addingMedia.value = false
  }
}

// External App Hand-off sub-picker (spec section 12): pick a configured profile and, if its
// Parameter Format needs one, the file to hand it. Add-time verification (exe/file exist) —
// "robustness priority over convenience" — runs before the item is actually added, so a
// broken path is caught during prep rather than discovered mid-service.
const externalAppProfileId = ref<string>()
const externalAppFile = ref<string>()
const addingExternalApp = ref(false)
const externalAppAddError = ref<string>()
const selectedExternalAppProfile = computed(() =>
  externalAppsStore.profiles.find((profile) => profile.id === externalAppProfileId.value),
)
const externalAppNeedsFile = computed(
  () => selectedExternalAppProfile.value?.parameterFormat?.includes('{file}') ?? false,
)

async function pickExternalAppFile() {
  const path = await getAdapter().externalApps?.pickFile()
  if (path) externalAppFile.value = path
}
async function addExternalAppToService() {
  if (addingExternalApp.value || !externalAppProfileId.value) return
  addingExternalApp.value = true
  externalAppAddError.value = undefined
  try {
    await getAdapter().externalApps?.verifyItem(externalAppProfileId.value, externalAppFile.value)
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'external-app',
      profileId: externalAppProfileId.value,
      file: externalAppFile.value,
    }
    insertItem(item)
    closeAddDialog()
  } catch (e) {
    externalAppAddError.value = errorMessage(e, 'Failed to verify this app.')
  } finally {
    addingExternalApp.value = false
  }
}

// Sermon sub-picker: a reorderable list of passages (each its own ScriptureReferencePicker,
// same as the Scripture tab, just N instances), one marked "main" for the printed bulletin
// line (see orderOfWorship.ts), then a presentable outline — same block-editor pattern as the
// Slides tab's "+ New Text Slides".
interface SermonPassageDraft {
  id: string
  value: ScriptureReferenceValue
}
const sermonTitleDraft = ref('')
const sermonPassages = ref<SermonPassageDraft[]>([])
const sermonMainPassageId = ref<string>()
const sermonOutlineBlocks = ref<SongBlock[]>([])
const sermonPassagePickerRefs = ref<
  Record<string, InstanceType<typeof ScriptureReferencePicker> | null>
>({})
const addingSermon = ref(false)

function setSermonPassageRef(id: string, el: unknown) {
  sermonPassagePickerRefs.value[id] = el as InstanceType<typeof ScriptureReferencePicker> | null
}
function addSermonPassage() {
  const id = `passage-${crypto.randomUUID()}`
  sermonPassages.value.push({
    id,
    value: { reference: '', translation: scriptureDraft.value.translation, displayMode: 'full' },
  })
  if (!sermonMainPassageId.value) sermonMainPassageId.value = id
}
async function removeSermonPassage(id: string) {
  const index = sermonPassages.value.findIndex((p) => p.id === id)
  if (index === -1) return
  if (!(await confirmDialog.confirm('Remove this passage?', 'Remove'))) return
  sermonPassages.value.splice(index, 1)
  delete sermonPassagePickerRefs.value[id]
  if (sermonMainPassageId.value === id) sermonMainPassageId.value = sermonPassages.value[0]?.id
}
function addSermonOutlineBlock() {
  sermonOutlineBlocks.value.push({
    id: `outline-${crypto.randomUUID()}`,
    label: `Point ${sermonOutlineBlocks.value.length + 1}`,
    text: '',
  })
}
async function removeSermonOutlineBlock(index: number) {
  const target = sermonOutlineBlocks.value[index]
  if (!target) return
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  sermonOutlineBlocks.value.splice(index, 1)
}
const sermonPassagesValid = computed(() =>
  sermonPassages.value.every((p) => sermonPassagePickerRefs.value[p.id]?.isValid),
)

async function addSermonToService() {
  if (
    sermonPassages.value.length === 0 ||
    !sermonMainPassageId.value ||
    !sermonPassagesValid.value ||
    addingSermon.value
  ) {
    return
  }
  addingSermon.value = true
  try {
    const passages: SermonPassage[] = sermonPassages.value.map((p) => ({
      id: p.id,
      reference: p.value.reference,
      translation: p.value.translation,
      displayMode: p.value.displayMode,
    }))
    const item: ServiceItem = {
      id: `item-${crypto.randomUUID()}`,
      type: 'sermon',
      title: sermonTitleDraft.value.trim() || undefined,
      passages,
      mainPassageId: sermonMainPassageId.value,
      outline: sermonOutlineBlocks.value.map((block) => ({ ...block })),
    }
    insertItem(item)
    for (const passage of sermonPassages.value) {
      const resolved = sermonPassagePickerRefs.value[passage.id]?.resolvedPassage
      if (resolved && passage.value.displayMode === 'full')
        props.scriptureById.set(`${item.id}:${passage.id}`, resolved)
    }
    closeAddDialog()
  } finally {
    addingSermon.value = false
  }
}

// Bulletin Note sub-picker: a line that only ever appears in the printed Order of Worship (see
// orderOfWorship.ts) — its heading/body are the shared bulletinLabel/bulletinNote fields
// every item has, not fields of their own (see ServiceItemContent's BulletinNote variant).
const bulletinNoteLabel = ref('')
const bulletinNoteText = ref('')

function addBulletinNoteToService() {
  if (!bulletinNoteLabel.value.trim()) return
  const item: ServiceItem = {
    id: `item-${crypto.randomUUID()}`,
    type: 'bulletin-note',
    bulletinLabel: bulletinNoteLabel.value.trim(),
    bulletinNote: bulletinNoteText.value.trim() || undefined,
  }
  insertItem(item)
  closeAddDialog()
}

function closeAddDialog() {
  open.value = false
  addQuery.value = ''
  scriptureDraft.value = { reference: '', translation: '', displayMode: 'full' }
  // Forces a fresh ScriptureReferencePicker instance next open — the component owns its own
  // entry-mode/book/chapter/verse state internally, so remounting (rather than trying to push
  // a reset into it via props) is what actually clears a half-typed reference between opens.
  scripturePickerResetKey.value++
  slideQuery.value = ''
  slidesSubMode.value = 'pick'
  newTextSlideBlocks.value = []
  mediaQuery.value = ''
  videoQuery.value = ''
  mediaFit.value = 'cover'
  externalAppProfileId.value = undefined
  externalAppFile.value = undefined
  externalAppAddError.value = undefined
  sermonTitleDraft.value = ''
  sermonPassages.value = []
  sermonMainPassageId.value = undefined
  sermonOutlineBlocks.value = []
  sermonPassagePickerRefs.value = {}
  bulletinNoteLabel.value = ''
  bulletinNoteText.value = ''
}
</script>

<template>
  <v-dialog v-model="open" max-width="560">
    <!-- height must be the v-card PROP, not a height CSS class — Vuetify's own dialog
         stylesheet applies `flex: 1 1 var(--v-card-height, 100%)` to any .v-card inside a
         .v-dialog, and flex-basis overrides a plain `height` for sizing purposes regardless
         of specificity. Only the height PROP populates that --v-card-height variable. -->
    <v-card height="640" class="add-service-card">
      <v-card-title>Add {{ typeTitle }}</v-card-title>
      <v-card-text>
        <v-window v-model="addTab">
          <v-window-item value="songs">
            <v-text-field
              v-model="addQuery"
              label="Search songs…"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-magnify"
              autofocus
            />
            <v-list :disabled="addingSong">
              <v-list-item
                v-for="song in filteredSongsForAdd"
                :key="song.id"
                :title="song.title"
                :subtitle="song.artist || song.author"
                @click="addSongToService(song)"
              />
            </v-list>
          </v-window-item>

          <v-window-item value="scripture">
            <ScriptureReferencePicker
              :key="scripturePickerResetKey"
              ref="scripturePickerRef"
              v-model="scriptureDraft"
              :translations="scriptureTranslations"
            />

            <v-btn
              variant="flat"
              color="primary"
              block
              :disabled="
                !scripturePickerRef?.isValid ||
                (scriptureDraft.displayMode === 'full' &&
                  (!scriptureDraft.translation || scripturePickerRef?.hasError))
              "
              :loading="addingScripture"
              @click="addScriptureToService"
            >
              Add Scripture
            </v-btn>
          </v-window-item>

          <v-window-item value="slides">
            <v-btn-toggle v-model="slidesSubMode" mandatory density="compact" divided class="mb-4">
              <v-btn value="pick" size="small">Pick from Library</v-btn>
              <v-btn value="new" size="small">+ New Text Slides</v-btn>
            </v-btn-toggle>

            <template v-if="slidesSubMode === 'pick'">
              <v-text-field
                v-model="slideQuery"
                label="Search slides…"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-magnify"
                autofocus
              />
              <v-list :disabled="addingSlideRef">
                <v-list-item
                  v-for="slideItem in filteredSlidesForAdd"
                  :key="slideItem.id"
                  :title="slideItem.label"
                  :subtitle="
                    slideItem.slides.length === 1 ? '1 slide' : `${slideItem.slides.length} slides`
                  "
                  @click="addSlideRefToService(slideItem)"
                />
              </v-list>
              <p v-if="filteredSlidesForAdd.length === 0" class="text-medium-emphasis text-body-2">
                No slides found.
              </p>
            </template>

            <template v-else>
              <p class="text-caption text-medium-emphasis mb-3">
                Saved with this service only — not added to the Slide Library.
              </p>
              <VueDraggable
                v-model="newTextSlideBlocks"
                handle=".drag-handle"
                :animation="150"
                class="d-flex flex-column ga-2 mb-3"
              >
                <v-card
                  v-for="(block, index) in newTextSlideBlocks"
                  :key="block.id"
                  variant="outlined"
                  rounded="lg"
                >
                  <div class="d-flex align-center ga-2 px-2 py-1 border-b">
                    <v-icon
                      icon="mdi-drag-vertical"
                      class="drag-handle"
                      size="small"
                      style="cursor: grab"
                    />
                    <v-text-field
                      v-model="block.label"
                      variant="filled"
                      density="compact"
                      hide-details
                      class="flex-grow-1"
                    />
                    <v-btn
                      icon="mdi-trash-can-outline"
                      variant="flat"
                      color="error"
                      size="small"
                      @click="removeNewTextSlideBlock(index)"
                    />
                  </div>
                  <v-textarea
                    v-model="block.text"
                    variant="filled"
                    density="compact"
                    rows="2"
                    auto-grow
                    hide-details
                    class="px-2 py-1"
                  />
                </v-card>
              </VueDraggable>
              <v-btn
                variant="flat"
                color="primary"
                class="mb-3"
                prepend-icon="mdi-plus"
                @click="addNewTextSlideBlock"
              >
                Add Slide
              </v-btn>
              <v-btn
                variant="flat"
                color="primary"
                block
                :disabled="newTextSlideBlocks.length === 0"
                @click="addTextSlideToService"
              >
                Add to Service
              </v-btn>
            </template>
          </v-window-item>

          <v-window-item value="media">
            <v-btn-toggle v-model="mediaFit" mandatory density="compact" divided class="mb-4">
              <v-btn value="cover" size="small">Cover (crop to fill)</v-btn>
              <v-btn value="contain" size="small">Contain (show in full)</v-btn>
            </v-btn-toggle>
            <v-text-field
              v-model="mediaQuery"
              label="Search media…"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-magnify"
              autofocus
            />
            <v-list :disabled="addingMedia">
              <v-list-item
                v-for="item in filteredMediaForAdd"
                :key="item.id"
                :title="item.filename"
                prepend-icon="mdi-image-outline"
                @click="addMediaToService(item)"
              />
            </v-list>
            <p v-if="filteredMediaForAdd.length === 0" class="text-medium-emphasis text-body-2">
              No images found in the Media Library.
            </p>
          </v-window-item>

          <v-window-item value="video">
            <v-text-field
              v-model="videoQuery"
              label="Search videos…"
              variant="outlined"
              density="comfortable"
              prepend-inner-icon="mdi-magnify"
              autofocus
            />
            <v-list :disabled="addingMedia">
              <v-list-item
                v-for="item in filteredVideoForAdd"
                :key="item.id"
                :title="item.filename"
                prepend-icon="mdi-movie-open-outline"
                @click="addVideoToService(item)"
              />
            </v-list>
            <p v-if="filteredVideoForAdd.length === 0" class="text-medium-emphasis text-body-2">
              No videos found in the Media Library.
            </p>
          </v-window-item>

          <v-window-item value="external-app">
            <p v-if="externalAppsStore.profiles.length === 0" class="text-medium-emphasis text-body-2">
              No profiles configured yet — add one in Settings &gt; External Apps.
            </p>
            <v-select
              v-else
              v-model="externalAppProfileId"
              :items="externalAppsStore.profiles"
              item-title="name"
              item-value="id"
              label="App Profile"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <template v-if="selectedExternalAppProfile">
              <v-text-field
                v-if="externalAppNeedsFile"
                :model-value="externalAppFile"
                label="File"
                variant="outlined"
                density="comfortable"
                readonly
                class="mb-2"
              >
                <template #append>
                  <v-btn variant="outlined" @click="pickExternalAppFile">Browse…</v-btn>
                </template>
              </v-text-field>
              <v-alert v-if="externalAppAddError" type="error" variant="tonal" density="compact" class="mb-3">
                {{ externalAppAddError }}
              </v-alert>
              <v-btn
                variant="flat"
                color="primary"
                block
                :loading="addingExternalApp"
                :disabled="externalAppNeedsFile && !externalAppFile"
                @click="addExternalAppToService"
              >
                Add to Service
              </v-btn>
            </template>
          </v-window-item>

          <v-window-item value="sermon">
            <v-text-field
              v-model="sermonTitleDraft"
              label="Sermon Title (optional)"
              placeholder="e.g. Our Lord's Prayer"
              variant="outlined"
              class="mb-3"
            />
            <div class="text-overline text-medium-emphasis mb-2">Passages</div>
            <v-card
              v-for="passage in sermonPassages"
              :key="passage.id"
              variant="outlined"
              rounded="lg"
              class="pa-3 mb-3"
            >
              <div class="d-flex align-center justify-space-between mb-2">
                <v-btn
                  :variant="sermonMainPassageId === passage.id ? 'flat' : 'outlined'"
                  :color="sermonMainPassageId === passage.id ? 'primary' : undefined"
                  size="small"
                  prepend-icon="mdi-star"
                  @click="sermonMainPassageId = passage.id"
                >
                  {{ sermonMainPassageId === passage.id ? 'Main Passage' : 'Set as Main' }}
                </v-btn>
                <v-btn
                  icon="mdi-delete-outline"
                  variant="text"
                  size="small"
                  @click="removeSermonPassage(passage.id)"
                />
              </div>
              <ScriptureReferencePicker
                :ref="(el) => setSermonPassageRef(passage.id, el)"
                v-model="passage.value"
                :translations="scriptureTranslations"
              />
            </v-card>
            <v-btn variant="outlined" class="mb-4" prepend-icon="mdi-plus" @click="addSermonPassage"
              >Add Passage</v-btn
            >

            <div class="text-overline text-medium-emphasis mb-2">Outline</div>
            <p class="text-caption text-medium-emphasis mb-3">
              Presentable points for this sermon only — not added to the Slide Library.
            </p>
            <VueDraggable
              v-model="sermonOutlineBlocks"
              handle=".drag-handle"
              :animation="150"
              class="d-flex flex-column ga-2 mb-3"
            >
              <v-card
                v-for="(block, index) in sermonOutlineBlocks"
                :key="block.id"
                variant="outlined"
                rounded="lg"
              >
                <div class="d-flex align-center ga-2 px-2 py-1 border-b">
                  <v-icon
                    icon="mdi-drag-vertical"
                    class="drag-handle"
                    size="small"
                    style="cursor: grab"
                  />
                  <v-text-field
                    v-model="block.label"
                    variant="filled"
                    density="compact"
                    hide-details
                    class="flex-grow-1"
                  />
                  <v-btn
                    icon="mdi-trash-can-outline"
                    variant="flat"
                    color="error"
                    size="small"
                    @click="removeSermonOutlineBlock(index)"
                  />
                </div>
                <v-textarea
                  v-model="block.text"
                  variant="filled"
                  density="compact"
                  rows="2"
                  auto-grow
                  hide-details
                  class="px-2 py-1"
                />
              </v-card>
            </VueDraggable>
            <v-btn
              variant="flat"
              color="primary"
              class="mb-3"
              prepend-icon="mdi-plus"
              @click="addSermonOutlineBlock"
            >
              Add Outline Point
            </v-btn>

            <v-btn
              variant="flat"
              color="primary"
              block
              :disabled="sermonPassages.length === 0 || !sermonMainPassageId || !sermonPassagesValid"
              :loading="addingSermon"
              @click="addSermonToService"
            >
              Add Sermon
            </v-btn>
          </v-window-item>

          <v-window-item value="bulletin-note">
            <v-text-field
              v-model="bulletinNoteLabel"
              label="Bulletin Label"
              placeholder="e.g. Silent Preparation"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <v-textarea
              v-model="bulletinNoteText"
              label="Bulletin Note (optional)"
              placeholder="e.g. (please spend the next few moments preparing your heart for corporate worship)"
              variant="outlined"
              density="comfortable"
              rows="2"
              auto-grow
              class="mb-3"
            />
            <p class="text-caption text-medium-emphasis mb-3">
              This item only appears in the printed Order of Worship — it never becomes a slide.
            </p>
            <v-btn
              variant="flat"
              color="primary"
              block
              :disabled="!bulletinNoteLabel.trim()"
              @click="addBulletinNoteToService"
            >
              Add to Service
            </v-btn>
          </v-window-item>
        </v-window>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="flat" color="secondary" @click="closeAddDialog">Cancel</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* One fixed size regardless of which type is selected — a long song library, several sermon
   passages, or the outline editor could otherwise each drive the card to a different (and
   sometimes viewport-exceeding) height. An explicit height (via the v-card height prop, see
   the template comment above) + flex column here, with only the content area scrolling
   internally, keeps title/type-select/Cancel fixed and always visible no matter what's
   selected. */
.add-service-card {
  display: flex;
  flex-direction: column;
}
:deep(.v-card-title),
:deep(.v-card-actions) {
  flex-shrink: 0;
}
:deep(.v-card-text) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
