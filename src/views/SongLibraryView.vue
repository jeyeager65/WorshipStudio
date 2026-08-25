<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useFiltersPanel } from '@/composables/useFiltersPanel'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { useSongsStore } from '@/stores/songs'
import { useSettingsStore } from '@/stores/settings'
import { useSongCollectionsStore } from '@/stores/songCollections'
import { useServicesStore } from '@/stores/services'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import AlphabetIndexRail from '@/components/AlphabetIndexRail.vue'
import type { Song } from '@/models/song'
import type { ServiceItem } from '@/models/service'
import {
  compactPlanningSongSlots,
  emptyPlanningSongSlot,
  fillPlanningSongSlot,
  isPlanningSongSlot,
} from '@/utils/planningSongs'
import {
  getLastUsedDate,
  getUsesInPastYear,
  todayLocal,
  isArchiveCandidate as isSongArchiveCandidate,
} from '@/utils/songUsage'
import { sortTitle } from '@/utils/songSort'
import {
  ALPHABET_INDEX_LETTERS,
  groupByIndexLetter,
  scrollToIndexHeading,
} from '@/utils/alphabetIndex'

const router = useRouter()
const route = useRoute()
const store = useSongsStore()
const settingsStore = useSettingsStore()
const songCollectionsStore = useSongCollectionsStore()
const servicesStore = useServicesStore()
const confirmDialog = useConfirmDialogStore()

const query = ref('')
const activeCollection = ref<string>()
const activeTag = ref<string>()
const showArchived = ref(false)
const selectingSongId = ref<string>()
const { filtersOpen, toggleFilters, closeFilters } = useFiltersPanel()

const selectionServiceId = computed(() =>
  typeof route.query.selectFor === 'string' ? route.query.selectFor : undefined,
)
const selectionMode = computed(() => !!selectionServiceId.value)
const selectionService = computed(() =>
  servicesStore.services.find((service) => service.id === selectionServiceId.value),
)
const selectedSongIds = computed(
  () =>
    new Set(
      selectionService.value?.items
        .filter((item) => item.type === 'song')
        .map((item) => item.songId) ?? [],
    ),
)
const selectedSongs = ref<Song[]>([])
function syncSelectedSongs() {
  const service = selectionService.value
  selectedSongs.value = !service
    ? []
    : service.items
        .filter((item) => item.type === 'song')
        .map((item) => store.songs.find((song) => song.id === item.songId))
        .filter((song): song is Song => !!song)
}
watch([selectionService, () => store.songs], syncSelectedSongs, { immediate: true })

onMounted(async () => {
  await Promise.all([
    store.loaded ? Promise.resolve() : store.load(),
    settingsStore.load(),
    songCollectionsStore.loaded ? Promise.resolve() : songCollectionsStore.load(),
    selectionMode.value && !servicesStore.loaded ? servicesStore.load() : Promise.resolve(),
  ])
})

// Archived songs are a separate mode from the active library, not blended into one list —
// collection/tag filter counts, search, and the empty states below all scope to whichever one
// is currently showing.
const allSongs = computed(() => store.songs)
const archivedCount = computed(() => allSongs.value.filter((song) => song.archived).length)
// The "All Songs" filter's own count — deliberately not visibleSongs.length, which already
// reflects whichever of the two the operator has selected. This one stays fixed so the sidebar
// reads the same regardless of which of the two is currently active, same as Media Library's
// "All Media"/"Images"/"Videos" filter counts.
const activeSongsCount = computed(() => allSongs.value.filter((song) => !song.archived).length)
const visibleSongs = computed(() =>
  allSongs.value.filter((song) => !!song.archived === showArchived.value),
)
// Falls back to the raw id for a song referencing a collection that's since been deleted from
// Settings — rare, but better than the filter/label silently vanishing for that song.
function collectionName(id: string): string {
  return songCollectionsStore.collections.find((definition) => definition.id === id)?.name ?? id
}

const collectionFilters = computed(() => {
  const ids = new Set(songCollectionsStore.collections.map((collection) => collection.id))
  for (const song of visibleSongs.value)
    for (const collection of song.collections) ids.add(collection.collectionId)
  return [...ids]
    .filter(Boolean)
    .map((id) => ({ id, name: collectionName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => ({
      id,
      name,
      count: visibleSongs.value.filter((song) =>
        song.collections.some((entry) => entry.collectionId === id),
      ).length,
    }))
})
const tagFilters = computed(() => {
  const counts = new Map<string, number>()
  for (const song of visibleSongs.value) {
    for (const tag of song.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }))
})

const filteredSongs = computed(() => {
  // Vuetify's clearable button sets the model to null, not '' — clearing without this guard
  // throws mid-computed (.trim() on null), which silently breaks the clear button.
  const q = (query.value ?? '').trim().toLowerCase()
  const sorted = [...visibleSongs.value].sort((a, b) =>
    sortTitle(a.title).localeCompare(sortTitle(b.title)),
  )
  return sorted.filter((song) => {
    if (
      activeCollection.value &&
      !song.collections.some((entry) => entry.collectionId === activeCollection.value)
    )
      return false
    if (activeTag.value && !song.tags.includes(activeTag.value)) return false
    if (!q) return true
    if ([song.title, song.author, song.artist].some((field) => field?.toLowerCase().includes(q)))
      return true
    if (song.tags.some((tag) => tag.toLowerCase().includes(q))) return true
    return song.collections.some((c) => collectionName(c.collectionId).toLowerCase().includes(q))
  })
})
const activeFilterCount = computed(
  () => Number(!!activeCollection.value) + Number(!!activeTag.value) + Number(showArchived.value),
)

// filteredSongs is already sorted by sortTitle, so groups come out in order for free.
const groupedSongs = computed(() =>
  groupByIndexLetter(filteredSongs.value, (song) => sortTitle(song.title)),
)
const availableSongLetters = computed(
  () => new Set(groupedSongs.value.map((group) => group.letter)),
)
// Only alongside an actual list — the empty/error states have nothing to index into.
const showIndexRail = computed(() => store.loaded && filteredSongs.value.length > 0)
const songListEl = ref<HTMLElement>()
function scrollToSongLetter(letter: string) {
  const heading = document.getElementById(`song-letter-${letter}`)
  if (songListEl.value && heading) scrollToIndexHeading(songListEl.value, heading)
}

function clearFilters() {
  activeCollection.value = undefined
  activeTag.value = undefined
  query.value = ''
  showArchived.value = false
}

// Archived is exclusive with the collection/tag filters, same as "All Songs" — they scope to a
// different underlying set (visibleSongs), so leaving a collection/tag selected while switching
// would silently carry over a filter that may not even apply to the new set.
function toggleArchivedFilter() {
  showArchived.value = !showArchived.value
  activeCollection.value = undefined
  activeTag.value = undefined
}

// Artist (who this is known for/performed by) is what's actually useful when browsing/picking a
// song, so it takes priority here — Author stays the field of record for CCLI reporting, but
// most songs don't have a distinct Artist set, so falling back to Author keeps this line from
// going blank for them.
function creditLabel(song: Song): string {
  return song.artist || song.author || 'Unknown artist'
}

// A song's collections/hymnal number, e.g. "Hymnal One #184, Hymnal Two #92" — omits the
// number for a collection that doesn't have one set yet.
function collectionsLabel(song: Song): string {
  return song.collections
    .map((c) =>
      c.number ? `${collectionName(c.collectionId)} #${c.number}` : collectionName(c.collectionId),
    )
    .join(', ')
}

function firstCollectionLabel(song: Song): string | undefined {
  const collection = song.collections[0]
  if (!collection) return undefined
  return collection.number
    ? `${collectionName(collection.collectionId)} #${collection.number}`
    : collectionName(collection.collectionId)
}

// The same usage data as the Song Editor, split into two aligned lines in this directory —
// derived live at display time from song.usageDates (see utils/songUsage.ts), which is kept
// current by an incremental update on every service save/delete rather than recomputed here.
const today = todayLocal()

function lastUsedLabel(song: Song): string {
  const lastUsedDate = getLastUsedDate(song.usageDates, today)
  // A song can have a lastUsedDate with 0 uses in the past year — used before, just not within
  // the last 365 days (a song doesn't need any use in the past year to have ever been used at
  // all).
  if (!lastUsedDate) return 'Not yet used'
  const last = new Date(`${lastUsedDate}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `Last used ${last}`
}

function yearlyUsageLabel(song: Song): string {
  return `${getUsesInPastYear(song.usageDates, today)}x in the past year`
}

// A nudge, not a rule — surfaced only in the active view, since a song that's already archived
// doesn't need to be told it's a candidate for the thing it already is. See
// utils/songUsage.ts's isArchiveCandidate for why this uses an 18-month window rather than the
// rolling-365-day "uses in the past year" figure above.
function isArchiveCandidate(song: Song): boolean {
  return isSongArchiveCandidate(song.usageDates, today)
}

// Reversible, unlike Delete — hides the song from this list and the Add-to-Service picker
// without touching anything it's already used in (see the Song model's own doc comment).
async function archiveSong(song: Song) {
  await store.save({ ...song, archived: true })
}
async function unarchiveSong(song: Song) {
  await store.save({ ...song, archived: false })
}

async function deleteSong(song: Song) {
  if (!(await confirmDialog.confirm(`Delete "${song.title}"?`, 'Delete'))) return
  await store.remove(song.id)
}

// The new song only exists in memory until the editor's Save button is used (see
// SongEditorView) — creating it here immediately would leave a blank file on disk the
// moment this button is clicked, even if the user backs out without entering anything.
function createSong() {
  router.push('/library/songs/new')
}

function openSong(song: Song) {
  router.push(`/library/songs/${song.id}`)
}

async function togglePlanSong(song: Song) {
  const service = selectionService.value
  if (!service || selectingSongId.value) return
  selectingSongId.value = song.id
  try {
    const alreadySelected = selectedSongIds.value.has(song.id)
    let items: ServiceItem[]
    if (alreadySelected) {
      items = compactPlanningSongSlots(
        service.items.map((item) =>
          item.type === 'song' && item.songId === song.id ? emptyPlanningSongSlot(item) : item,
        ),
      )
    } else {
      const openSlotIndex = service.items.findIndex(
        (item) => isPlanningSongSlot(item) && item.type === 'placeholder',
      )
      if (openSlotIndex === -1) {
        items = [
          ...service.items,
          {
            id: `item-${crypto.randomUUID()}`,
            type: 'song',
            songId: song.id,
            arrangement: { sequence: [...song.defaultArrangement.sequence] },
          },
        ]
      } else {
        items = [...service.items]
        items[openSlotIndex] = fillPlanningSongSlot(items[openSlotIndex]!, song)
      }
    }
    await servicesStore.save({ ...service, items })
  } finally {
    selectingSongId.value = undefined
  }
}

async function saveSelectedSongOrder() {
  const service = selectionService.value
  if (!service || selectingSongId.value) return
  selectingSongId.value = 'reordering'
  try {
    const songItems = new Map(
      service.items.filter((item) => item.type === 'song').map((item) => [item.songId, item]),
    )
    const orderedSongItems = selectedSongs.value
      .map((song) => songItems.get(song.id))
      .filter((item) => !!item)
    let songIndex = 0
    const items = service.items.map((item) => {
      if (item.type !== 'song') return item
      const song = orderedSongItems[songIndex++]
      if (!song) return item
      return {
        ...song,
        id: item.id,
        roleId: item.roleId,
        bulletinLabel: item.bulletinLabel,
        bulletinNote: item.bulletinNote,
      }
    })
    await servicesStore.save({ ...service, items })
  } finally {
    selectingSongId.value = undefined
  }
}

function handleSongCard(song: Song) {
  if (selectionMode.value) void togglePlanSong(song)
  else openSong(song)
}

function finishSelection() {
  const destination = typeof route.query.returnTo === 'string' ? route.query.returnTo : '/'
  router.push(destination)
}
</script>

<template>
  <main class="songs-page">
    <div class="songs-page-content">
      <header class="songs-hero app-page-hero">
        <div>
          <div class="page-eyebrow">Content Library</div>
          <h1>{{ selectionMode ? 'Choose Songs' : 'Songs' }}</h1>
          <p>
            {{
              selectionMode
                ? 'Browse the full library and select songs for this service plan.'
                : 'Organize lyrics, arrangements, collections, and service usage in one searchable library.'
            }}
          </p>
        </div>
        <div class="songs-summary" aria-label="Song library summary">
          <div class="summary-stat">
            <strong>{{ visibleSongs.length }}</strong>
            <span>Songs</span>
          </div>
          <div class="summary-stat">
            <strong>{{ collectionFilters.length }}</strong>
            <span>Collections</span>
          </div>
          <div class="summary-stat">
            <strong>{{ tagFilters.length }}</strong>
            <span>Tags</span>
          </div>
        </div>
      </header>

      <section
        v-if="selectionMode"
        class="selected-set-panel"
        aria-label="Songs selected for this plan"
      >
        <header class="selected-set-heading">
          <span
            ><v-icon icon="mdi-playlist-music" size="20" /><strong>{{
              selectedSongs.length
            }}</strong>
            selected for this plan</span
          >
          <v-btn color="primary" variant="flat" size="small" @click="finishSelection">Done</v-btn>
        </header>
        <VueDraggable
          v-if="selectedSongs.length"
          v-model="selectedSongs"
          class="selected-set-list"
          handle=".selected-set-drag"
          :animation="150"
          @end="saveSelectedSongOrder"
        >
          <div v-for="song in selectedSongs" :key="song.id" class="selected-set-row">
            <v-icon icon="mdi-drag-vertical" size="18" class="selected-set-drag" />
            <span
              ><strong>{{ song.title }}</strong
              ><small v-if="firstCollectionLabel(song)">{{
                firstCollectionLabel(song)
              }}</small></span
            >
            <v-btn
              icon="mdi-close"
              size="x-small"
              variant="text"
              aria-label="Remove from plan"
              @click="togglePlanSong(song)"
            />
          </div>
        </VueDraggable>
        <p v-else class="selected-set-empty">Select songs from the library below.</p>
      </section>

      <section class="songs-directory">
        <div class="songs-toolbar">
          <div class="songs-toolbar-heading">
            <h2>Song Library</h2>
            <p>
              {{ filteredSongs.length }} {{ filteredSongs.length === 1 ? 'song' : 'songs' }}
              <template v-if="activeFilterCount">
                with {{ activeFilterCount }} active
                {{ activeFilterCount === 1 ? 'filter' : 'filters' }}</template
              >
              <template v-if="query"> matching your search</template>
            </p>
          </div>
          <div class="songs-actions">
            <!-- Only rendered once the filters collapse out of the sidebar (see the 900px "compact"
               block) — below that they live in a slide-over panel this opens. -->
            <v-btn
              v-if="allSongs.length"
              class="app-filters-toggle"
              variant="tonal"
              density="comfortable"
              icon="mdi-filter-variant"
              :aria-label="filtersOpen ? 'Hide filters' : 'Show filters'"
              :aria-expanded="filtersOpen"
              @click="toggleFilters"
            />
            <v-text-field
              v-if="visibleSongs.length"
              v-model="query"
              prepend-inner-icon="mdi-magnify"
              placeholder="Search title, author, collection, or tag"
              aria-label="Search songs"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              class="song-search"
            />
            <v-btn
              v-if="!selectionMode && !showArchived"
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              class="new-song-btn app-icon-btn"
              @click="createSong"
              ><span class="app-btn-label">New Song</span></v-btn
            >
          </div>
        </div>

        <div
          class="songs-directory-body"
          :class="{ 'songs-directory-body--empty': allSongs.length === 0 }"
        >
          <!-- Gated on allSongs, not visibleSongs — a library that's all-archived (or, before any
             songs exist yet, all-active-and-empty) still needs the Archived filter reachable,
             not hidden along with the rest of the sidebar just because the *current* mode has
             nothing to show. -->
          <!-- One <aside>, two presentations: a permanent sidebar on wide screens, and below the shared
             900px "compact" breakpoint a slide-over panel over the list (CSS only) — same
             markup either way rather than a second copy of every filter for small screens. -->
          <div
            v-if="allSongs.length"
            class="app-filters-scrim"
            :class="{ 'app-filters-scrim--open': filtersOpen }"
            @click="closeFilters"
          />
          <aside
            v-if="allSongs.length"
            class="song-filters app-filters"
            :class="{ 'app-filters--open': filtersOpen }"
            aria-label="Filter songs"
          >
            <button
              type="button"
              class="song-filter song-filter--all"
              :class="{ 'song-filter--active': !activeCollection && !activeTag && !showArchived }"
              @click="clearFilters"
            >
              <span class="song-filter-icon"><v-icon icon="mdi-music-note" size="18" /></span>
              <span>All Songs</span>
              <strong>{{ activeSongsCount }}</strong>
            </button>
            <button
              type="button"
              class="song-filter song-filter--archived"
              :class="{ 'song-filter--active': showArchived }"
              @click="toggleArchivedFilter"
            >
              <span class="song-filter-icon"><v-icon icon="mdi-archive-outline" size="17" /></span>
              <span>Archived</span>
              <strong>{{ archivedCount }}</strong>
            </button>

            <div class="filter-section">
              <div class="filter-heading">Collections</div>
              <button
                v-for="filter in collectionFilters"
                :key="filter.id"
                type="button"
                class="song-filter song-filter--collection"
                :class="{ 'song-filter--active': activeCollection === filter.id }"
                @click="activeCollection = activeCollection === filter.id ? undefined : filter.id"
              >
                <span class="song-filter-icon"><v-icon icon="mdi-bookshelf" size="17" /></span>
                <span>{{ filter.name }}</span>
                <strong>{{ filter.count }}</strong>
              </button>
              <p v-if="collectionFilters.length === 0" class="filter-empty">
                No collections configured
              </p>
            </div>

            <div class="filter-section">
              <div class="filter-heading">Tags</div>
              <button
                v-for="filter in tagFilters"
                :key="filter.name"
                type="button"
                class="song-filter song-filter--tag"
                :class="{ 'song-filter--active': activeTag === filter.name }"
                @click="activeTag = activeTag === filter.name ? undefined : filter.name"
              >
                <span class="song-filter-icon"><v-icon icon="mdi-tag-outline" size="17" /></span>
                <span>{{ filter.name }}</span>
                <strong>{{ filter.count }}</strong>
              </button>
              <p v-if="tagFilters.length === 0" class="filter-empty">No tags added</p>
            </div>
          </aside>

          <div class="song-results">
            <AsyncLoadState
              v-if="!store.loaded"
              :loading="store.loading"
              :error="store.loadError"
              label="songs"
              @retry="store.load"
            />
            <AsyncLoadState
              v-if="store.loaded && store.loadError"
              :loading="false"
              :error="store.loadError"
              label="updated songs"
              compact
              class="mb-3"
              @retry="store.load"
            />
            <LibraryEmptyState
              v-if="store.loaded && allSongs.length === 0"
              icon="mdi-music-note-plus"
              title="No Songs Yet"
              message="Create a song, or import an existing OpenSong library from Settings → Library & Sync."
            >
              <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="createSong"
                >New Song</v-btn
              >
            </LibraryEmptyState>
            <LibraryEmptyState
              v-else-if="store.loaded && showArchived && visibleSongs.length === 0"
              icon="mdi-archive-off-outline"
              title="No Archived Songs"
              message="Songs you archive from the active library will show up here."
            >
              <v-btn variant="text" color="primary" @click="showArchived = false"
                >Back to Active Songs</v-btn
              >
            </LibraryEmptyState>
            <LibraryEmptyState
              v-else-if="store.loaded && filteredSongs.length === 0"
              icon="mdi-music-note-off"
              title="No Songs Found"
              message="No songs match the selected collection, tag, and search."
            >
              <v-btn variant="text" color="primary" @click="clearFilters">Clear Filters</v-btn>
            </LibraryEmptyState>

            <div v-else-if="store.loaded" ref="songListEl" class="song-list app-page-scroll">
              <template v-for="group in groupedSongs" :key="group.letter">
                <div :id="`song-letter-${group.letter}`" class="song-list-heading">
                  {{ group.letter }}
                </div>
                <article
                  v-for="song in group.items"
                  :key="song.id"
                  class="song-card"
                  :class="{ 'song-card--selected': selectionMode && selectedSongIds.has(song.id) }"
                  tabindex="0"
                  @click="handleSongCard(song)"
                  @keydown.enter="handleSongCard(song)"
                  @keydown.space.prevent="handleSongCard(song)"
                >
                  <span class="song-icon"><v-icon icon="mdi-music-note" size="22" /></span>
                  <div class="song-identity">
                    <h3>{{ song.title }}</h3>
                    <p>{{ creditLabel(song) }}</p>
                  </div>
                  <div class="song-metadata">
                    <div v-if="song.collections.length" class="song-collections">
                      <span class="metadata-label"
                        ><v-icon icon="mdi-bookshelf" size="15" />Collections</span
                      >
                      <strong>{{ collectionsLabel(song) }}</strong>
                    </div>
                    <div v-if="song.tags.length" class="song-tags">
                      <span v-for="tag in song.tags" :key="tag">{{ tag }}</span>
                    </div>
                    <span
                      v-if="!song.collections.length && !song.tags.length"
                      class="song-no-metadata"
                      >No collections or tags</span
                    >
                  </div>
                  <span class="song-usage">
                    <v-icon icon="mdi-history" size="17" />
                    <span>
                      <strong>{{ lastUsedLabel(song) }}</strong>
                      <small>{{ yearlyUsageLabel(song) }}</small>
                    </span>
                    <v-chip
                      v-if="!showArchived && isArchiveCandidate(song)"
                      size="x-small"
                      color="amber"
                      variant="tonal"
                      class="archive-hint"
                    >
                      Not used in a while
                    </v-chip>
                  </span>
                  <v-btn
                    v-if="selectionMode"
                    :icon="selectedSongIds.has(song.id) ? 'mdi-check' : 'mdi-plus'"
                    :color="selectedSongIds.has(song.id) ? 'primary' : undefined"
                    :loading="selectingSongId === song.id"
                    variant="text"
                    size="small"
                    :aria-label="selectedSongIds.has(song.id) ? 'Remove from plan' : 'Add to plan'"
                    @click.stop="togglePlanSong(song)"
                  />
                  <v-menu v-else>
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        icon="mdi-dots-horizontal"
                        variant="text"
                        size="small"
                        aria-label="Song actions"
                        @click.stop
                      />
                    </template>
                    <v-list density="compact">
                      <v-list-item
                        prepend-icon="mdi-pencil-outline"
                        title="Edit Song"
                        @click="openSong(song)"
                      />
                      <v-list-item
                        v-if="!showArchived"
                        prepend-icon="mdi-archive-outline"
                        title="Archive Song"
                        @click="archiveSong(song)"
                      />
                      <v-list-item
                        v-else
                        prepend-icon="mdi-archive-arrow-up-outline"
                        title="Unarchive Song"
                        @click="unarchiveSong(song)"
                      />
                      <v-list-item
                        prepend-icon="mdi-trash-can-outline"
                        title="Delete Song"
                        class="text-error"
                        @click="deleteSong(song)"
                      />
                    </v-list>
                  </v-menu>
                </article>
              </template>
            </div>
          </div>
        </div>
      </section>
    </div>
    <!-- Page-level, not inside the list card: anchored here it spans everything under the app-bar
         rather than only the list pane, which on a tall window left it stranded across less than
         half the height. Same placement as a phone contacts index — at the edge of the screen,
         not inside the content it indexes. -->
    <AlphabetIndexRail
      v-if="showIndexRail"
      :letters="ALPHABET_INDEX_LETTERS"
      :available-letters="availableSongLetters"
      class="page-rail"
      @select="scrollToSongLetter"
    />
  </main>
</template>

<style scoped>
/* The song list owns the scrolling here, not the page — the hero/toolbar stay put and only the
   list moves, so the A-Z rail can hold a fixed position instead of scrolling away with the list
   exactly when the list is long enough to need one. Same structure as a phone contacts screen:
   fixed chrome, one scrolling list.
   height: 100% (not a 100dvh-minus-app-bar calc) because the parent <v-main scrollable> renders
   a .v-main__scroller that is already inset to exactly the area below the app-bar — filling it
   is exact and needs no app-bar arithmetic, which measured wrong anyway: --v-layout-top reads as
   0px down here, so subtracting it silently left the page a full app-bar too tall.
   A row, so the rail sits beside the whole page and inherits its full height. */
.songs-page {
  display: flex;
  height: 100%;
  justify-content: center;
  gap: 14px;
  padding: 24px clamp(20px, 3vw, 48px);
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-teal), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.songs-page-content {
  display: flex;
  min-width: 0;
  max-width: 1240px;
  flex: 1;
  flex-direction: column;
}
/* Stretches to the page's full height (the flex default), which is the whole point of hanging it
   here rather than inside the list card. */
.page-rail {
  flex-shrink: 0;
}
/* width: 100% matters now that these sit in a flex column — auto side margins on a flex item
   shrink it to its content width instead of filling the line the way they did under block
   layout, which left both cards floating narrow in the middle of the page. The 1240px cap now
   lives on .songs-page-content, so these just fill it. */
.songs-hero,
.songs-directory {
  width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
/* Takes the leftover height under the hero and passes it down to the list pane. min-height: 0
   at every level because a flex item's default min-height: auto refuses to shrink below its
   content, which would push the list's own scrollbar back out to the page. */
.songs-directory {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.selected-set-panel {
  width: 100%;
  max-width: 1240px;
  margin: 0 auto 18px;
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 9px;
  background: rgba(var(--v-theme-surface), 0.96);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.1);
}
.selected-set-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
}
.selected-set-heading > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.72rem;
}
.selected-set-heading .v-icon,
.selected-set-heading strong {
  color: rgb(var(--v-theme-primary));
}
.selected-set-drag {
  color: rgba(var(--v-theme-on-surface), 0.34);
  cursor: grab;
}
.selected-set-drag:active {
  cursor: grabbing;
}
.selected-set-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.selected-set-row {
  display: grid;
  min-width: 0;
  grid-template-columns: 22px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  background: rgba(var(--v-theme-surface), 0.98);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.selected-set-row:last-child {
  border-bottom: 0;
}
.selected-set-row > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.selected-set-row strong,
.selected-set-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selected-set-row strong {
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.7rem;
}
.selected-set-row small {
  margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.61rem;
}
.selected-set-empty {
  margin: 0;
  padding: 12px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.7rem;
}
.songs-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-teal));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.songs-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.songs-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.songs-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 105px;
  flex-direction: column;
  align-items: center;
  padding: 11px 15px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-teal));
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
.songs-directory {
  overflow: hidden;
}
.songs-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 78px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.songs-toolbar h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.songs-toolbar p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.songs-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.song-search {
  width: min(350px, 28vw);
}
.song-search :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
.songs-directory-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 230px minmax(0, 1fr);
}
.songs-directory-body--empty {
  grid-template-columns: minmax(0, 1fr);
}
.song-filters {
  padding: 14px 11px 18px;
  overflow-y: auto;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.17);
}
.filter-section {
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.filter-heading {
  padding: 0 9px 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.song-filter {
  --filter-color: rgb(var(--v-theme-slate));
  position: relative;
  display: grid;
  width: 100%;
  min-height: 42px;
  grid-template-columns: 29px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
  padding: 4px 9px 4px 7px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 590;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.song-filter::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--filter-color);
  content: '';
  opacity: 0;
}
.song-filter:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.song-filter--active {
  border-color: color-mix(in srgb, var(--filter-color) 23%, transparent);
  background: color-mix(in srgb, var(--filter-color) 10%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.song-filter--active::before {
  opacity: 1;
}
.song-filter:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--filter-color) 65%, transparent);
  outline-offset: 1px;
}
.song-filter--all,
.song-filter--collection {
  --filter-color: rgb(var(--v-theme-teal));
}
.song-filter--tag {
  --filter-color: rgb(var(--v-theme-violet));
}
.song-filter-icon {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--filter-color) 11%, transparent);
  color: var(--filter-color);
}
.song-filter strong {
  display: grid;
  min-width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}
.filter-empty {
  margin: 2px 9px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.7rem;
}
.song-results {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
/* flex/min-height/overflow come from .app-page-scroll (assets/base.css) — this only adds what is
   specific to the song list. */
.song-list {
  /* One source of truth for the list inset: the sticky headings below cancel it with a negative
     margin so their background spans the full width, and the two silently stopped cancelling when
     the phone breakpoint changed the padding alone -- leaving the heading hanging 4px over each
     edge and giving the list a horizontal scrollbar. */
  --list-pad: 14px;

  container: song-list / inline-size;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: var(--list-pad);
}
/* Sticky within the scrolling list, so the letter you're inside stays named while you scroll
   through it — the opaque background is what keeps cards from showing through as they pass. */
.song-list-heading {
  position: sticky;
  top: calc(var(--list-pad) * -1);
  z-index: 1;
  flex-shrink: 0;
  margin: 0 calc(var(--list-pad) * -1);
  padding: 8px calc(var(--list-pad) + 4px) 6px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
/* flex-shrink: 0 because .song-list is now a height-constrained scrolling flex column — without
   it these compress toward min-height to fit rather than overflowing into a scroll. */
.song-card {
  display: grid;
  min-height: 86px;
  flex-shrink: 0;
  grid-template-columns: 44px minmax(220px, 1fr) 280px 175px 36px;
  align-items: center;
  gap: 13px;
  padding: 10px 10px 10px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.34);
  cursor: pointer;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast),
    transform var(--ws-transition-fast);
}
.song-card:hover,
.song-card:focus-visible {
  border-color: rgba(var(--v-theme-teal), 0.32);
  background: rgba(var(--v-theme-teal), 0.045);
  box-shadow: 0 9px 24px rgba(0, 0, 0, 0.1);
  outline: none;
  transform: translateY(-1px);
}
.song-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.09);
}
.song-card:focus-visible {
  box-shadow:
    0 9px 24px rgba(0, 0, 0, 0.1),
    inset 0 0 0 2px rgba(var(--v-theme-teal), 0.5);
}
.song-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-teal), 0.22);
  border-radius: 10px;
  background: rgba(var(--v-theme-teal), 0.11);
  color: rgb(var(--v-theme-teal));
}
.song-identity,
.song-metadata {
  min-width: 0;
}
.song-identity h3 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.02rem;
  font-weight: 720;
  letter-spacing: -0.012em;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.song-identity p {
  overflow: hidden;
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.song-metadata {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.song-collections {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  font-size: 0.74rem;
}
.song-collections strong {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-weight: 570;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.metadata-label {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: rgb(var(--v-theme-teal));
  font-size: 0.7rem;
  font-weight: 680;
  text-transform: uppercase;
}
.song-tags {
  display: flex;
  gap: 5px;
  overflow-x: auto;
}
.song-tags span {
  flex-shrink: 0;
  padding: 2px 7px;
  border: 1px solid rgba(var(--v-theme-violet), 0.18);
  border-radius: 5px;
  background: rgba(var(--v-theme-violet), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.7rem;
  font-weight: 580;
  white-space: nowrap;
}
.song-no-metadata {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.72rem;
}
.song-usage {
  display: inline-flex;
  align-items: center;
  justify-self: stretch;
  gap: 5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.74rem;
  line-height: 1.35;
  text-align: left;
}
.song-usage > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}
.song-usage strong {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-weight: 590;
  white-space: nowrap;
}
.song-usage small {
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.7rem;
  white-space: nowrap;
}
.archive-hint {
  flex-shrink: 0;
  white-space: nowrap;
}
.songs-empty-state {
  display: flex;
  min-height: 400px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.54);
  text-align: center;
}
.songs-empty-state > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-teal), 0.11);
  color: rgb(var(--v-theme-teal));
}
.songs-empty-state h2 {
  margin: 14px 0 3px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 1rem;
}
.songs-empty-state p {
  margin: 0 0 15px;
  font-size: 0.82rem;
}
.empty-state-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 1120px) {
  /* Only the toolbar stacks (heading above the controls) — the controls themselves stay a row so
     New Song keeps sitting beside the search field rather than dropping to a full-width bar of
     its own underneath it. */
  .songs-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .songs-actions {
    align-items: center;
    flex-direction: row;
  }
  .song-search {
    width: auto;
    flex: 1;
  }
}
/* .song-card's own responsive columns are keyed to .song-list's actual rendered width (a
   container query), not the window's — the window can be well above any of the @media
   breakpoints elsewhere on this page while the list column itself is still narrow, since the
   nav (224px, permanent ≥960px window width) and the filters sidebar (230px, permanent
   ≥900px window width — see .songs-directory-body below) both eat fixed space out of the
   window before the list ever sees it. A plain window-width @media query can't represent that:
   it would need to know whether the nav is a rail or overlay and whether the filters are a
   sidebar or a bar, not just the raw window width. Thresholds below are picked from the card's
   own content (see each rule). */
@container song-list (max-width: 820px) {
  /* Below the space needed for the full 5-column layout (icon + identity-at-least-220px +
     280px metadata + 175px usage + button, plus gaps) to avoid squeezing the identity column
     past readability. */
  .song-card {
    grid-template-columns: 44px minmax(180px, 1fr) 280px 36px;
  }
  .song-usage {
    display: none;
  }
}
/* The rail deliberately survives every width breakpoint below — a narrow screen is where a long
   list is hardest to scrub through by hand, so it's the case the rail exists for. It sizes its
   own width and glyphs to the space available (see AlphabetIndexRail.vue) rather than needing a
   breakpoint here. */
@container song-list (max-width: 600px) {
  /* Below the space needed for even the reduced 4-column layout above. */
  .song-card {
    grid-template-columns: 44px minmax(0, 1fr) 36px;
  }
  .song-metadata {
    display: none;
  }
}
/* 900px = the shared "compact" breakpoint (see assets/base.css). The slide-over panel itself is
   defined there too — all this page owns is collapsing the grid to one column and giving it the
   positioning context the panel is absolute against. */
@media (max-width: 900px) {
  .songs-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .songs-summary {
    align-self: flex-start;
  }
  .songs-directory-body {
    position: relative;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
  }
}
@media (max-width: 700px) {
  .songs-page {
    padding: 10px;
  }
  /* Everything here buys list height back on a phone, where the chrome above the list was
     eating more than half the viewport: the toolbar's title/count block duplicates the app-bar
     title, and search + filters + New Song fit on one row once the button drops to its icon. */
  .songs-toolbar {
    padding: 8px 10px;
  }
  .songs-toolbar-heading {
    display: none;
  }
  .songs-toolbar,
  .songs-actions {
    align-items: center;
    flex-direction: row;
  }
  .songs-actions {
    width: 100%;
    gap: 6px;
  }
  .song-search {
    width: auto;
    flex: 1;
  }
  .song-list {
    --list-pad: 10px;
  }
}
</style>
