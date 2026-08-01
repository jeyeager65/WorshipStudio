<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import SlideSceneRenderer from '@/components/slides/SlideSceneRenderer.vue'
import { useSlidesStore } from '@/stores/slides'
import { useUndoStore } from '@/stores/undo'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { SlideLibraryItem } from '@/models/library'

const router = useRouter()
const store = useSlidesStore()
const undoStore = useUndoStore()
const confirmDialog = useConfirmDialogStore()

const query = ref('')
const activeTag = ref<string>()
// Deletion is soft until the undo toast expires, consistent with the other libraries.
const pendingDeleteIds = reactive(new Set<string>())

onMounted(() => {
  if (!store.loaded) store.load()
})

const visibleItems = computed(() => store.slides.filter((item) => !pendingDeleteIds.has(item.id)))
const totalSlideCount = computed(() =>
  visibleItems.value.reduce((sum, item) => sum + item.slides.length, 0),
)
const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of visibleItems.value) {
    for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }))
})

const filteredSlides = computed(() => {
  // Vuetify's clearable button sets the model to null, not ''.
  const q = (query.value ?? '').trim().toLowerCase()
  return visibleItems.value
    .filter((item) => !activeTag.value || (item.tags ?? []).includes(activeTag.value))
    .filter(
      (item) =>
        !q ||
        item.label.toLowerCase().includes(q) ||
        (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
        item.slides.some((slide) => slide.label.toLowerCase().includes(q)),
    )
    .sort((a, b) => a.label.localeCompare(b.label))
})

function clearFilters() {
  query.value = ''
  activeTag.value = undefined
}

function lastUsedLabel(item: SlideLibraryItem): string {
  if (!item.usage.lastUsedAt) return 'Not Yet Used'
  const date = new Date(`${item.usage.lastUsedAt}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `Last Used ${date}`
}

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

function createSlide() {
  router.push('/library/slides/new')
}

function openSlide(item: SlideLibraryItem) {
  router.push(`/library/slides/${item.id}`)
}
</script>

<template>
  <main class="slides-page">
    <header class="slides-hero">
      <div>
        <div class="slides-page-eyebrow">Content Library</div>
        <h1>Slides</h1>
        <p>
          Create reusable presentations for announcements, welcome screens, and other visual
          moments.
        </p>
      </div>
      <div class="slides-summary" aria-label="Slide library summary">
        <div class="slides-summary-stat">
          <strong>{{ visibleItems.length }}</strong>
          <span>Presentations</span>
        </div>
        <div class="slides-summary-stat">
          <strong>{{ totalSlideCount }}</strong>
          <span>Slides</span>
        </div>
        <div class="slides-summary-stat">
          <strong>{{ tagCounts.length }}</strong>
          <span>Tags</span>
        </div>
      </div>
    </header>

    <section class="slides-directory">
      <div class="slides-toolbar">
        <div>
          <h2>Slide Library</h2>
          <p>
            {{ filteredSlides.length }}
            {{ filteredSlides.length === 1 ? 'presentation' : 'presentations' }}
            <template v-if="activeTag"> with 1 active filter</template>
            <template v-if="query"> matching your search</template>
          </p>
        </div>
        <div class="slides-actions">
          <v-text-field
            v-if="visibleItems.length"
            v-model="query"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search presentation, slide, or tag"
            aria-label="Search slides"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            class="slide-search"
          />
          <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="createSlide"
            >New Presentation</v-btn
          >
        </div>
      </div>

      <div
        class="slides-directory-body"
        :class="{ 'slides-directory-body--empty': visibleItems.length === 0 }"
      >
        <aside v-if="visibleItems.length" class="slide-filters" aria-label="Filter slides">
          <button
            type="button"
            class="slide-filter slide-filter--all"
            :class="{ 'slide-filter--active': !activeTag }"
            @click="activeTag = undefined"
          >
            <span class="slide-filter-icon"><v-icon icon="mdi-presentation" size="18" /></span>
            <span>All Presentations</span>
            <strong>{{ visibleItems.length }}</strong>
          </button>

          <div class="slide-filter-section">
            <div class="slide-filter-heading">Tags</div>
            <button
              v-for="tag in tagCounts"
              :key="tag.name"
              type="button"
              class="slide-filter slide-filter--tag"
              :class="{ 'slide-filter--active': activeTag === tag.name }"
              @click="activeTag = activeTag === tag.name ? undefined : tag.name"
            >
              <span class="slide-filter-icon"><v-icon icon="mdi-tag-outline" size="17" /></span>
              <span>{{ tag.name }}</span>
              <strong>{{ tag.count }}</strong>
            </button>
            <p v-if="tagCounts.length === 0" class="slide-filter-empty">No tags added</p>
          </div>
        </aside>

        <div class="slide-results">
          <div v-if="visibleItems.length === 0" class="slides-empty-state">
            <span><v-icon icon="mdi-presentation-play" size="30" /></span>
            <h2>No Presentations Yet</h2>
            <p>Create a reusable presentation for announcements or service visuals.</p>
            <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" @click="createSlide"
              >New Presentation</v-btn
            >
          </div>
          <div v-else-if="filteredSlides.length === 0" class="slides-empty-state">
            <span><v-icon icon="mdi-presentation-play" size="30" /></span>
            <h2>No Presentations Found</h2>
            <p>No presentations match the selected tag and search.</p>
            <v-btn variant="text" color="primary" @click="clearFilters">Clear Filters</v-btn>
          </div>

          <div v-else class="presentation-grid">
            <article
              v-for="presentation in filteredSlides"
              :key="presentation.id"
              class="presentation-card"
              tabindex="0"
              @click="openSlide(presentation)"
              @keydown.enter="openSlide(presentation)"
              @keydown.space.prevent="openSlide(presentation)"
            >
              <div class="presentation-preview">
                <SlideSceneRenderer
                  v-if="presentation.slides[0]"
                  :scene="presentation.slides[0].scene"
                />
                <span v-else class="preview-empty"
                  ><v-icon icon="mdi-presentation" size="34"
                /></span>
                <span class="slide-count-badge">
                  <v-icon icon="mdi-view-carousel-outline" size="14" />
                  {{ presentation.slides.length }}
                  {{ presentation.slides.length === 1 ? 'Slide' : 'Slides' }}
                </span>
              </div>

              <div class="presentation-card-body">
                <div class="presentation-heading">
                  <div class="presentation-identity">
                    <h3>{{ presentation.label }}</h3>
                    <p>{{ presentation.slides[0]?.label || 'Empty Presentation' }}</p>
                  </div>
                  <v-menu>
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        icon="mdi-dots-horizontal"
                        variant="text"
                        size="small"
                        aria-label="Presentation actions"
                        @click.stop
                      />
                    </template>
                    <v-list density="compact">
                      <v-list-item
                        prepend-icon="mdi-pencil-outline"
                        title="Edit Presentation"
                        @click="openSlide(presentation)"
                      />
                      <v-list-item
                        prepend-icon="mdi-trash-can-outline"
                        title="Delete Presentation"
                        class="text-error"
                        @click="deleteSlide(presentation)"
                      />
                    </v-list>
                  </v-menu>
                </div>

                <div class="presentation-tags">
                  <span v-for="tag in presentation.tags ?? []" :key="tag">{{ tag }}</span>
                  <span v-if="!(presentation.tags ?? []).length" class="presentation-no-tags"
                    >Untagged</span
                  >
                </div>

                <div class="presentation-footer">
                  <span
                    ><v-icon icon="mdi-layers-triple-outline" size="16" />{{
                      presentation.slides.length
                    }}
                    Total</span
                  >
                  <span class="presentation-usage-label">
                    <strong>{{ lastUsedLabel(presentation) }}</strong>
                    <small>{{ presentation.usage.usesPastYear }}x This Year</small>
                  </span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style>
.slides-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-secondary), 0.05), transparent 430px),
    rgb(var(--v-theme-background));
}
.slides-hero,
.slides-directory {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.slides-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.slides-page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-secondary));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.slides-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.slides-hero p {
  max-width: 650px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.slides-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.slides-summary-stat {
  display: flex;
  min-width: 105px;
  flex-direction: column;
  align-items: center;
  padding: 11px 15px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.slides-summary-stat:last-child {
  border-right: 0;
}
.slides-summary-stat strong {
  color: rgb(var(--v-theme-secondary));
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.slides-summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
.slides-directory {
  overflow: hidden;
}
.slides-toolbar {
  display: flex;
  min-height: 78px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.slides-toolbar h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 680;
}
.slides-toolbar p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.slides-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.slide-search {
  width: min(370px, 30vw);
}
.slides-page .slide-search .v-field {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
  font-size: 0.82rem;
}
.slides-directory-body {
  display: grid;
  min-height: 470px;
  grid-template-columns: 230px minmax(0, 1fr);
}
.slides-directory-body--empty {
  grid-template-columns: minmax(0, 1fr);
}
.slide-filters {
  padding: 14px 11px 18px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.17);
}
.slide-filter-section {
  margin-top: 15px;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.slide-filter-heading {
  padding: 0 9px 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.slide-filter {
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
}
.slide-filter::before {
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
.slide-filter:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.9);
}
.slide-filter--active {
  border-color: color-mix(in srgb, var(--filter-color) 23%, transparent);
  background: color-mix(in srgb, var(--filter-color) 10%, transparent);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.slide-filter--active::before {
  opacity: 1;
}
.slide-filter:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--filter-color) 65%, transparent);
  outline-offset: 1px;
}
.slide-filter--all {
  --filter-color: rgb(var(--v-theme-secondary));
}
.slide-filter--tag {
  --filter-color: rgb(var(--v-theme-violet));
}
.slide-filter-icon {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--filter-color) 11%, transparent);
  color: var(--filter-color);
}
.slide-filter strong {
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
.slide-filter-empty {
  margin: 2px 9px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.7rem;
}
.slide-results {
  min-width: 0;
}
.presentation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 13px;
  padding: 14px;
}
.presentation-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.34);
  cursor: pointer;
  transition:
    border-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast),
    transform var(--ws-transition-fast);
}
.presentation-card:hover,
.presentation-card:focus-visible {
  border-color: rgba(var(--v-theme-secondary), 0.34);
  box-shadow: 0 11px 26px rgba(0, 0, 0, 0.13);
  outline: none;
  transform: translateY(-2px);
}
.presentation-preview {
  position: relative;
  display: grid;
  aspect-ratio: 16 / 9;
  place-items: center;
  overflow: hidden;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: #090b0f;
}
.slides-page .presentation-preview .scene {
  width: 100%;
  height: 100%;
}
.preview-empty {
  color: rgba(var(--v-theme-on-surface), 0.36);
}
.slide-count-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 5px;
  background: rgba(8, 11, 16, 0.8);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.66rem;
  font-weight: 680;
  text-transform: uppercase;
  backdrop-filter: blur(7px);
}
.presentation-card-body {
  padding: 12px 13px 11px;
}
.presentation-heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 6px;
}
.presentation-identity {
  min-width: 0;
  flex: 1;
}
.presentation-identity h3 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1rem;
  font-weight: 710;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.presentation-identity p {
  overflow: hidden;
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.71rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.presentation-tags {
  display: flex;
  min-height: 25px;
  gap: 5px;
  margin-top: 12px;
  overflow-x: auto;
}
.presentation-tags span {
  flex-shrink: 0;
  padding: 2px 7px;
  border: 1px solid rgba(var(--v-theme-violet), 0.18);
  border-radius: 5px;
  background: rgba(var(--v-theme-violet), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.69rem;
  font-weight: 580;
  white-space: nowrap;
}
.presentation-tags .presentation-no-tags {
  border-color: transparent;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-style: italic;
}
.presentation-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.presentation-footer > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: rgb(var(--v-theme-secondary));
  font-size: 0.71rem;
  font-weight: 620;
}
.presentation-usage-label {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.35;
}
.presentation-usage-label strong {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.68rem;
  font-weight: 580;
}
.presentation-usage-label small {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.66rem;
}
.slides-empty-state {
  display: flex;
  min-height: 430px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.54);
  text-align: center;
}
.slides-empty-state > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-secondary), 0.11);
  color: rgb(var(--v-theme-secondary));
}
.slides-empty-state h2 {
  margin: 14px 0 3px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 1rem;
}
.slides-empty-state p {
  margin: 0 0 15px;
  font-size: 0.82rem;
}
@media (max-width: 960px) {
  .slides-toolbar,
  .slides-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .slide-search {
    width: min(520px, 100%);
  }
}
@media (max-width: 820px) {
  .slides-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .slides-summary {
    align-self: flex-start;
  }
  .slides-directory-body {
    grid-template-columns: 1fr;
  }
  .slide-filters {
    display: flex;
    gap: 5px;
    padding: 9px 11px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .slide-filter-section {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    padding: 0 0 0 8px;
    border-top: 0;
    border-left: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  }
  .slide-filter-heading,
  .slide-filter-empty {
    display: none;
  }
  .slide-filter {
    width: auto;
    min-width: max-content;
    grid-template-columns: 27px auto auto;
    margin-bottom: 0;
  }
}
@media (max-width: 620px) {
  .slides-page {
    padding: 14px 12px 40px;
  }
  .slides-summary {
    width: 100%;
  }
  .slides-summary-stat {
    min-width: 0;
    flex: 1;
  }
  .presentation-grid {
    grid-template-columns: 1fr;
  }
}
</style>
