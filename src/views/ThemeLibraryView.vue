<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getAdapter } from '@/adapters'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import type { PresentationThemeTarget, Theme } from '@/models/library'
import {
  isPresentationThemeAvailableFor,
  presentationThemeAppliesTo,
  presentationThemeDefaults,
} from '@/utils/presentationTheme'
import { resolvePresentationFontFamily } from '@/utils/presentationFonts'
import { presentationTextEffect, presentationTextShadow } from '@/utils/presentationTextEffect'

const router = useRouter()
const store = useThemesStore()
const mediaStore = useMediaStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()
const mediaUrls = reactive<Record<string, string>>({})
const activeFilter = ref<'all' | PresentationThemeTarget>('all')
const amazingGracePreview = [
  'Amazing grace! how sweet the sound',
  'That saved a wretch like me!',
  'I once was lost, but now am found,',
  'Was blind, but now I see.',
]
const targetLabels: Record<PresentationThemeTarget, string> = {
  songs: 'Songs',
  scripture: 'Scripture',
  sermon: 'Sermons',
  'text-slides': 'Text Slides',
}
const filterOptions: { value: 'all' | PresentationThemeTarget; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: 'mdi-view-grid-outline' },
  { value: 'songs', label: 'Songs', icon: 'mdi-music-note-outline' },
  { value: 'scripture', label: 'Scripture', icon: 'mdi-book-cross' },
  { value: 'sermon', label: 'Sermons', icon: 'mdi-book-open-page-variant-outline' },
  { value: 'text-slides', label: 'Text Slides', icon: 'mdi-text-box-outline' },
]

onMounted(async () => {
  await Promise.all([store.load(), mediaStore.load(), settingsStore.load()])
  if (!getAdapter().media.getFilePath) return
  await Promise.all(
    store.themes.map(async (theme) => {
      if (!theme.backgroundId || !mediaStore.items.some((item) => item.id === theme.backgroundId))
        return
      try {
        mediaUrls[theme.id] = convertFileSrc(
          await getAdapter().media.getFilePath!(theme.backgroundId),
        )
      } catch (error) {
        console.error(`Failed to load preview for ${theme.name}:`, error)
      }
    }),
  )
})

const sortedThemes = computed(() => [...store.themes].sort((a, b) => a.name.localeCompare(b.name)))
const filteredThemes = computed(() =>
  activeFilter.value === 'all'
    ? sortedThemes.value
    : sortedThemes.value.filter((theme) =>
        isPresentationThemeAvailableFor(theme, activeFilter.value as PresentationThemeTarget),
      ),
)

function mediaItem(theme: Theme) {
  return mediaStore.items.find((item) => item.id === theme.backgroundId)
}

function backgroundStyle(theme: Theme) {
  if (theme.backgroundId === 'brand-primary')
    return { background: settingsStore.librarySettings?.branding.primaryColor ?? '#3B5BDB' }
  if (theme.backgroundId === 'brand-secondary')
    return { background: settingsStore.librarySettings?.branding.secondaryColor ?? '#8A5BD6' }
  return { background: theme.backgroundColor ?? '#000000' }
}

function defaultLabels(theme: Theme): string[] {
  return presentationThemeDefaults(theme).map((target) => targetLabels[target])
}

function applicabilityLabel(theme: Theme): string {
  const targets = presentationThemeAppliesTo(theme)
  return targets.length
    ? targets.map((target) => targetLabels[target]).join(', ')
    : 'All content types'
}

function openTheme(theme: Theme) {
  void router.push({ name: 'theme-editor', params: { id: theme.id } })
}

function createTheme() {
  void router.push({ name: 'theme-editor', params: { id: 'new' } })
}

async function deleteTheme(theme: Theme) {
  if (!(await confirmDialog.confirm(`Delete "${theme.name}"? This can't be undone.`, 'Delete')))
    return
  await store.remove(theme.id)
}

// useAsDefaultFor deliberately cleared — a duplicate shouldn't silently compete with the
// original as a content type's default; the original stays the default until changed by hand.
// updatedAt/updatedByDevice aren't set here since save() (both the Tauri and mock adapters)
// overwrites them itself regardless of what's passed in.
async function duplicateTheme(theme: Theme) {
  await store.save({
    ...theme,
    id: `theme-${crypto.randomUUID()}`,
    name: `${theme.name} (Copy)`,
    useAsDefaultFor: [],
  })
}
</script>

<template>
  <main class="themes-library-page">
    <header class="library-hero">
      <div>
        <div class="page-eyebrow">Audience Presentation</div>
        <h1>Presentation Themes</h1>
        <p>Choose reusable backgrounds and text styling for generated presentation content.</p>
      </div>
      <div class="hero-summary">
        <strong>{{ sortedThemes.length }}</strong>
        <span>{{ sortedThemes.length === 1 ? 'Theme' : 'Themes' }}</span>
      </div>
    </header>

    <section class="theme-directory">
      <header class="directory-toolbar">
        <div>
          <h2>Theme Library</h2>
          <p>Preview each theme before opening the full editor.</p>
        </div>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTheme">
          New Theme
        </v-btn>
      </header>

      <div
        v-if="sortedThemes.length"
        class="theme-filters"
        aria-label="Filter themes by content type"
      >
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          :class="{ active: activeFilter === option.value }"
          @click="activeFilter = option.value"
        >
          <v-icon :icon="option.icon" size="17" />
          {{ option.label }}
        </button>
      </div>

      <AsyncLoadState
        v-if="!store.loaded"
        :loading="store.loading"
        :error="store.loadError"
        label="presentation themes"
        @retry="store.load"
      />
      <AsyncLoadState
        v-if="store.loaded && store.loadError"
        :loading="false"
        :error="store.loadError"
        label="updated presentation themes"
        compact
        class="mb-3"
        @retry="store.load"
      />

      <div v-if="store.loaded && filteredThemes.length" class="theme-grid">
        <article
          v-for="theme in filteredThemes"
          :key="theme.id"
          class="theme-card"
          tabindex="0"
          @click="openTheme(theme)"
          @keydown.enter="openTheme(theme)"
          @keydown.space.prevent="openTheme(theme)"
        >
          <div class="theme-preview" :style="backgroundStyle(theme)">
            <img
              v-if="mediaUrls[theme.id] && mediaItem(theme)?.kind === 'image'"
              :src="mediaUrls[theme.id]"
              class="preview-background"
              alt=""
            />
            <video
              v-else-if="mediaUrls[theme.id] && mediaItem(theme)?.kind === 'video'"
              :src="mediaUrls[theme.id]"
              class="preview-background"
              autoplay
              loop
              muted
              playsinline
            />
            <div
              class="preview-text"
              :style="{
                color: theme.textColor,
                fontFamily: resolvePresentationFontFamily(theme.font),
                textShadow: presentationTextShadow(presentationTextEffect(theme)),
              }"
            >
              <span v-for="line in amazingGracePreview" :key="line">{{ line }}</span>
            </div>
          </div>
          <div class="theme-card-body">
            <div>
              <h3>{{ theme.name }}</h3>
              <p class="theme-applicability">{{ applicabilityLabel(theme) }}</p>
              <p v-if="defaultLabels(theme).length">
                Default for {{ defaultLabels(theme).join(', ') }}
              </p>
            </div>
            <div class="theme-card-actions">
              <v-btn
                icon="mdi-content-copy"
                variant="text"
                size="small"
                aria-label="Duplicate theme"
                @click.stop="duplicateTheme(theme)"
              />
              <v-btn
                icon="mdi-trash-can-outline"
                variant="text"
                size="small"
                color="error"
                aria-label="Delete theme"
                @click.stop="deleteTheme(theme)"
              />
              <v-icon icon="mdi-chevron-right" size="20" />
            </div>
          </div>
        </article>
      </div>

      <div v-else-if="store.loaded && !sortedThemes.length" class="empty-state">
        <span><v-icon icon="mdi-palette-outline" size="31" /></span>
        <h2>No Presentation Themes Yet</h2>
        <p>Create a reusable visual style for songs, scripture, sermons, and text slides.</p>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTheme">
          New Theme
        </v-btn>
      </div>
      <div v-else-if="store.loaded" class="empty-state empty-state--filtered">
        <span><v-icon icon="mdi-filter-outline" size="31" /></span>
        <h2>No Matching Themes</h2>
        <p>No themes are associated with this content type yet.</p>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-filter-remove-outline"
          @click="activeFilter = 'all'"
        >
          Show All Themes
        </v-btn>
      </div>
    </section>
  </main>
</template>

<style scoped>
.themes-library-page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 30px 34px 56px;
}
.library-hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 23px;
}
.page-eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.library-hero h1 {
  margin: 3px 0 5px;
  font-size: 2rem;
  line-height: 1.1;
}
.library-hero p,
.directory-toolbar p,
.theme-card-body p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.76rem;
}
.hero-summary {
  display: flex;
  min-width: 90px;
  flex-direction: column;
  align-items: center;
  padding: 10px 16px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.055);
}
.hero-summary strong {
  font-size: 1.25rem;
}
.hero-summary span {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.66rem;
}
.theme-directory {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 13px;
  background: rgba(var(--v-theme-surface), 0.7);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.07);
}
.directory-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 17px 19px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.directory-toolbar h2 {
  margin: 0 0 2px;
  font-size: 0.9rem;
}
.theme-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 11px 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.theme-filters button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 999px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.62);
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 650;
}
.theme-filters button:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
}
.theme-filters button.active {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 15px;
  padding: 18px;
}
.theme-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 11px;
  background: rgba(var(--v-theme-background), 0.22);
  cursor: pointer;
  outline: none;
  transition: 0.15s ease;
}
.theme-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.34);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}
.theme-card:focus-visible {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.42);
}
.theme-preview {
  position: relative;
  display: flex;
  container-type: inline-size;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 18px;
  text-align: center;
}
.preview-background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview-text {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  font-size: clamp(11px, 4.5cqw, 24px);
  font-weight: 700;
  line-height: 1.35;
}
.preview-text span {
  white-space: nowrap;
}
.theme-card-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.theme-card-body h3 {
  margin: 0 0 3px;
  font-size: 0.84rem;
}
.theme-card-body .theme-applicability {
  margin-bottom: 2px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-weight: 650;
}
.theme-card-actions {
  display: flex;
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.empty-state {
  display: flex;
  min-height: 430px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 28px;
  text-align: center;
}
.empty-state > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.empty-state h2 {
  margin: 14px 0 4px;
  font-size: 1rem;
}
.empty-state p {
  margin: 0 0 17px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.75rem;
}
.empty-state--filtered {
  min-height: 330px;
}
@media (max-width: 820px) {
  .themes-library-page {
    padding: 22px 16px 42px;
  }
  .library-hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .theme-grid {
    grid-template-columns: 1fr;
    padding: 12px;
  }
}
</style>
