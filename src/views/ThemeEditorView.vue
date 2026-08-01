<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getAdapter } from '@/adapters'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'
import type { PresentationThemeTarget, Theme } from '@/models/library'
import {
  normalizePresentationThemeTarget,
  presentationThemeDefaults,
} from '@/utils/presentationTheme'
import { bundledPresentationFonts, resolvePresentationFontFamily } from '@/utils/presentationFonts'
import {
  DEFAULT_PRESENTATION_TEXT_EFFECT,
  presentationTextEffect,
  presentationTextShadow,
} from '@/utils/presentationTextEffect'

const store = useThemesStore()
const mediaStore = useMediaStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()
const { isDirty, saving, saveHandler, pageTitleOverride } = storeToRefs(useUnsavedChangesStore())

// Themes are edited in place on this one screen (no per-theme route like Songs/Slides have)
// — switching the selected theme, rather than navigating away, is what risks silently
// discarding an edit, so that's what needs its own confirm rather than the router guard.
const selectedId = ref<string>()
const draft = ref<Theme>()

const fontOptions = bundledPresentationFonts
const defaultForOptions: {
  value: PresentationThemeTarget
  label: string
  description: string
  icon: string
}[] = [
  {
    value: 'songs',
    label: 'Songs',
    description: 'Lyrics generated from song arrangements',
    icon: 'mdi-music-note-outline',
  },
  {
    value: 'scripture',
    label: 'Scripture',
    description: 'Passages and reference-only slides',
    icon: 'mdi-book-cross',
  },
  {
    value: 'sermon',
    label: 'Sermons',
    description: 'Sermon passages and outline slides',
    icon: 'mdi-book-open-page-variant-outline',
  },
  {
    value: 'text-slides',
    label: 'Text Slides',
    description: 'Service-only text and announcement slides',
    icon: 'mdi-text-box-outline',
  },
]

function themeDefaultLabels(theme: Theme): string[] {
  return presentationThemeDefaults(theme).map(
    (target) => defaultForOptions.find((option) => option.value === target)?.label ?? target,
  )
}

onMounted(async () => {
  saveHandler.value = saveDraft
  pageTitleOverride.value = 'Presentation Themes'
  await Promise.all([store.load(), mediaStore.load(), settingsStore.load()])
  // Guarded on `draft` still being unset: without this, clicking "New Theme" while this load
  // is still in flight (a slow disk/sync folder, or just unlucky timing) gets silently
  // clobbered the instant it resolves, replacing the fresh draft with whatever theme happens
  // to load first.
  if (draft.value) return
  const first = store.themes[0]
  if (first) selectTheme(first.id)
})

onUnmounted(() => {
  isDirty.value = false
  saving.value = false
  saveHandler.value = undefined
  pageTitleOverride.value = undefined
})

function blankTheme(): Theme {
  return {
    id: `theme-${crypto.randomUUID()}`,
    name: 'New Theme',
    backgroundColor: '#000000',
    font: 'Inter Variable',
    textColor: '#FFFFFF',
    textEffect: { ...DEFAULT_PRESENTATION_TEXT_EFFECT },
    outline: true,
    useAsDefaultFor: [],
    updatedAt: '',
    updatedByDevice: '',
  }
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!isDirty.value) return true
  return confirmDialog.confirm('Discard unsaved theme changes?', 'Leave Without Saving')
}

async function selectTheme(id: string) {
  if (!(await confirmDiscardIfDirty())) return
  const theme = store.themes.find((t) => t.id === id)
  selectedId.value = id
  if (theme) {
    const next = structuredClone(toRaw(theme))
    next.font = resolvePresentationFontFamily(next.font)
    next.textEffect = presentationTextEffect(next)
    next.backgroundColor =
      next.backgroundColor ??
      (next.backgroundId === 'brand-primary'
        ? brandPrimary.value
        : next.backgroundId === 'brand-secondary'
          ? brandSecondary.value
          : '#000000')
    if (next.backgroundId === 'brand-primary' || next.backgroundId === 'brand-secondary')
      next.backgroundId = undefined
    draft.value = { ...next, useAsDefaultFor: presentationThemeDefaults(theme) }
  } else draft.value = undefined
  // Reassigning `draft` itself (not a nested edit) still triggers the deep watch below, on
  // the next reactivity flush — awaiting that flush first, then clearing dirty, is what makes
  // this the one that actually sticks; otherwise selecting an untouched existing theme left it
  // spuriously marked dirty moments later.
  await nextTick()
  isDirty.value = false
}

async function createTheme() {
  if (!(await confirmDiscardIfDirty())) return
  const theme = blankTheme()
  selectedId.value = theme.id
  draft.value = theme
  isDirty.value = true
}

// Registered once (not inside an async onMounted) so it's tied to this component's whole
// lifetime without the stop-handle dance the per-route editors need — see SongEditorView.
watch(draft, () => (isDirty.value = true), { deep: true })

async function saveDraft() {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) return
  draft.value.name = name
  draft.value.textEffect = presentationTextEffect(draft.value)
  // Keep older Worship Studio versions' switch meaningful when they read the same theme.
  draft.value.outline = draft.value.textEffect.type === 'outline'
  // Only one default may own a content type. This makes resolution deterministic and turns
  // selecting a default here into the expected reassignment rather than an ambiguous tie.
  const normalizedTargets = new Set<PresentationThemeTarget>()
  for (const target of draft.value.useAsDefaultFor as string[]) {
    const normalized = normalizePresentationThemeTarget(target)
    if (normalized) normalizedTargets.add(normalized)
  }
  draft.value.useAsDefaultFor = [...normalizedTargets]
  saving.value = true
  try {
    for (const theme of store.themes) {
      if (theme.id === draft.value.id) continue
      const remaining = theme.useAsDefaultFor.filter((target) => {
        const normalized = normalizePresentationThemeTarget(target)
        return !normalized || !normalizedTargets.has(normalized)
      })
      if (remaining.length !== theme.useAsDefaultFor.length)
        await store.save({ ...theme, useAsDefaultFor: remaining })
    }
    await store.save(structuredClone(toRaw(draft.value)))
    selectedId.value = draft.value.id
    isDirty.value = false
  } finally {
    saving.value = false
  }
}

async function deleteTheme(id: string) {
  const name = store.themes.find((t) => t.id === id)?.name ?? 'this theme'
  if (!(await confirmDialog.confirm(`Delete "${name}"? This can't be undone.`, 'Delete'))) return
  if (selectedId.value === id) {
    draft.value = undefined
    selectedId.value = undefined
    isDirty.value = false
  }
  await store.remove(id)
  const next = store.themes[0]
  if (next) await selectTheme(next.id)
}

function toggleDefaultFor(value: PresentationThemeTarget) {
  if (!draft.value) return
  const list = draft.value.useAsDefaultFor
  const index = list.indexOf(value)
  if (index === -1) list.push(value)
  else list.splice(index, 1)
}

const brandPrimary = computed(
  () => settingsStore.librarySettings?.branding.primaryColor ?? '#3B5BDB',
)
const brandSecondary = computed(
  () => settingsStore.librarySettings?.branding.secondaryColor ?? '#8A5BD6',
)

function isMediaBackground(id: string | undefined): id is string {
  return !!id && id !== 'brand-primary' && id !== 'brand-secondary'
}

const previewMediaItem = computed(() =>
  isMediaBackground(draft.value?.backgroundId)
    ? mediaStore.items.find((item) => item.id === draft.value?.backgroundId)
    : undefined,
)
const mediaPickerOpen = ref(false)
function chooseMediaBackground(mediaId: string) {
  if (!draft.value) return
  draft.value.backgroundId = mediaId
}
const previewMediaUrl = ref<string>()
let previewMediaRequest = 0
watch(
  () => draft.value?.backgroundId,
  async (id) => {
    const request = ++previewMediaRequest
    previewMediaUrl.value = undefined
    if (!isMediaBackground(id) || !getAdapter().media.getFilePath) return
    try {
      const path = await getAdapter().media.getFilePath!(id)
      if (request === previewMediaRequest) previewMediaUrl.value = convertFileSrc(path)
    } catch (error) {
      console.error('Failed to preview theme background:', error)
    }
  },
)

const previewBackgroundStyle = computed(() => {
  const id = draft.value?.backgroundId
  if (!id) return { background: draft.value?.backgroundColor ?? '#000000' }
  if (id === 'brand-primary') return { background: brandPrimary.value }
  if (id === 'brand-secondary') return { background: brandSecondary.value }
  // Real image/video previews aren't rendered here (see MediaLibraryView) — a placeholder
  // gradient stands in, same as a media card's own thumbnail.
  return {
    background: previewMediaUrl.value
      ? (draft.value?.backgroundColor ?? '#000000')
      : 'linear-gradient(135deg, #22262b, #3b5bdb)',
  }
})

function setThemeColor(field: 'backgroundColor' | 'textColor', event: Event) {
  if (!draft.value) return
  draft.value[field] = (event.target as HTMLInputElement).value
}

function setTextEffectColor(event: Event) {
  if (!draft.value?.textEffect) return
  draft.value.textEffect.color = (event.target as HTMLInputElement).value
}
</script>

<template>
  <main class="themes-page">
    <header class="themes-hero">
      <div>
        <span>Audience Presentation</span>
        <h1>Presentation Themes</h1>
        <p>
          Reusable backgrounds and text styling for generated songs, scripture, sermons, and text
          slides.
        </p>
      </div>
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTheme">
        New Theme
      </v-btn>
    </header>

    <section class="theme-workspace">
      <aside class="theme-directory">
        <header>
          <div>
            <strong>Theme Library</strong>
            <span
              >{{ store.themes.length }} reusable
              {{ store.themes.length === 1 ? 'theme' : 'themes' }}</span
            >
          </div>
        </header>
        <div class="theme-list">
          <button
            v-for="theme in store.themes"
            :key="theme.id"
            type="button"
            class="theme-card"
            :class="{ 'theme-card--active': selectedId === theme.id }"
            @click="selectTheme(theme.id)"
          >
            <span
              class="theme-swatch"
              :style="{
                background:
                  theme.backgroundId === 'brand-primary'
                    ? brandPrimary
                    : theme.backgroundId === 'brand-secondary'
                      ? brandSecondary
                      : isMediaBackground(theme.backgroundId)
                        ? 'linear-gradient(135deg, #22262b, #3b5bdb)'
                        : (theme.backgroundColor ?? '#000000'),
              }"
            />
            <span class="theme-card-copy">
              <strong>{{ theme.name }}</strong>
              <small v-if="themeDefaultLabels(theme).length">
                Default for {{ themeDefaultLabels(theme).join(', ') }}
              </small>
              <small v-else>Available as an override</small>
            </span>
            <v-icon icon="mdi-chevron-right" size="17" />
          </button>
          <div v-if="!store.themes.length" class="directory-empty">
            <v-icon icon="mdi-palette-outline" size="28" />
            <strong>No presentation themes</strong>
            <span>Create one to establish your audience-screen style.</span>
          </div>
        </div>
      </aside>

      <section v-if="draft" class="theme-editor">
        <header class="editor-heading">
          <div>
            <span>Theme details</span>
            <v-text-field
              v-model="draft.name"
              placeholder="Theme name"
              variant="plain"
              density="compact"
              hide-details
              class="theme-name-field"
            />
          </div>
          <v-btn
            icon="mdi-delete-outline"
            variant="text"
            color="error"
            size="small"
            aria-label="Delete theme"
            @click="deleteTheme(draft.id)"
          />
        </header>

        <div class="editor-layout">
          <div class="editor-settings">
            <section class="editor-section">
              <header>
                <span class="section-icon"><v-icon icon="mdi-image-outline" size="20" /></span>
                <div>
                  <h2>Background</h2>
                  <p>Choose a color or an image/video from the shared Media Library.</p>
                </div>
              </header>
              <div class="theme-color-field">
                <input
                  type="color"
                  :value="draft.backgroundColor ?? '#000000'"
                  aria-label="Choose background color"
                  @input="setThemeColor('backgroundColor', $event)"
                />
                <v-text-field
                  v-model="draft.backgroundColor"
                  label="Background color"
                  placeholder="#000000"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                />
              </div>
              <div class="media-background-field">
                <div v-if="previewMediaItem" class="selected-background">
                  <div class="selected-background-preview">
                    <img
                      v-if="previewMediaUrl && previewMediaItem.kind === 'image'"
                      :src="previewMediaUrl"
                      alt=""
                    />
                    <video
                      v-else-if="previewMediaUrl"
                      :src="previewMediaUrl"
                      muted
                      preload="metadata"
                    />
                    <v-icon v-else icon="mdi-image-outline" size="25" />
                  </div>
                  <div class="selected-background-copy">
                    <strong>{{ previewMediaItem.title || previewMediaItem.filename }}</strong>
                    <span>
                      {{ previewMediaItem.kind === 'video' ? 'Video' : 'Image' }} · Synced media
                    </span>
                  </div>
                  <v-btn variant="text" size="small" @click="mediaPickerOpen = true">
                    Change
                  </v-btn>
                  <v-btn
                    icon="mdi-close"
                    variant="text"
                    size="small"
                    aria-label="Remove media background"
                    @click="draft.backgroundId = undefined"
                  />
                </div>
                <button
                  v-else
                  type="button"
                  class="choose-background"
                  @click="mediaPickerOpen = true"
                >
                  <span><v-icon icon="mdi-image-search-outline" size="22" /></span>
                  <span>
                    <strong>Choose from Media Library</strong>
                    <small>Browse synced images and videos with previews and tags.</small>
                  </span>
                  <v-icon icon="mdi-chevron-right" size="18" />
                </button>
              </div>
            </section>

            <section class="editor-section">
              <header>
                <span class="section-icon"><v-icon icon="mdi-format-font" size="20" /></span>
                <div>
                  <h2>Text Styling</h2>
                  <p>Applied to generated text while existing font-size rules still control fit.</p>
                </div>
              </header>
              <div class="text-fields">
                <v-select
                  v-model="draft.font"
                  :items="fontOptions"
                  item-title="title"
                  item-value="value"
                  label="Font"
                  placeholder="Choose a bundled font"
                  variant="outlined"
                  density="comfortable"
                  hint="Bundled with Worship Studio for consistent presentation on every computer."
                  persistent-hint
                />
                <div class="theme-color-field">
                  <input
                    type="color"
                    :value="draft.textColor || '#FFFFFF'"
                    aria-label="Choose text color"
                    @input="setThemeColor('textColor', $event)"
                  />
                  <v-text-field
                    v-model="draft.textColor"
                    label="Text color"
                    placeholder="#FFFFFF"
                    variant="outlined"
                    density="comfortable"
                    hide-details
                  />
                </div>
              </div>
              <div v-if="draft.textEffect" class="text-effect-settings">
                <v-select
                  v-model="draft.textEffect.type"
                  :items="[
                    { title: 'None', value: 'none' },
                    { title: 'Outline', value: 'outline' },
                    { title: 'Drop Shadow', value: 'shadow' },
                    { title: 'Glow', value: 'glow' },
                  ]"
                  label="Text effect"
                  variant="outlined"
                  density="comfortable"
                  hide-details
                />
                <template v-if="draft.textEffect.type !== 'none'">
                  <div class="theme-color-field">
                    <input
                      type="color"
                      :value="draft.textEffect.color || '#000000'"
                      aria-label="Choose text effect color"
                      @input="setTextEffectColor"
                    />
                    <v-text-field
                      v-model="draft.textEffect.color"
                      label="Effect color"
                      placeholder="#000000"
                      variant="outlined"
                      density="comfortable"
                      hide-details
                    />
                  </div>
                  <v-number-input
                    v-model="draft.textEffect.size"
                    label="Strength"
                    variant="outlined"
                    density="comfortable"
                    control-variant="hidden"
                    :min="1"
                    :max="30"
                    hide-details
                  />
                  <template v-if="draft.textEffect.type === 'shadow'">
                    <v-number-input
                      v-model="draft.textEffect.offsetX"
                      label="Horizontal offset"
                      variant="outlined"
                      density="comfortable"
                      control-variant="hidden"
                      :min="-50"
                      :max="50"
                      hide-details
                    />
                    <v-number-input
                      v-model="draft.textEffect.offsetY"
                      label="Vertical offset"
                      variant="outlined"
                      density="comfortable"
                      control-variant="hidden"
                      :min="-50"
                      :max="50"
                      hide-details
                    />
                  </template>
                </template>
                <p>
                  Match the effect controls in the slide editor. Outline remains the default for
                  reliable contrast.
                </p>
              </div>
            </section>

            <section class="editor-section">
              <header>
                <span class="section-icon"><v-icon icon="mdi-star-outline" size="20" /></span>
                <div>
                  <h2>Default Uses</h2>
                  <p>
                    Each content type has one default. Individual service items can override it.
                  </p>
                </div>
              </header>
              <div class="default-grid">
                <button
                  v-for="option in defaultForOptions"
                  :key="option.value"
                  type="button"
                  :class="{ selected: draft.useAsDefaultFor.includes(option.value) }"
                  @click="toggleDefaultFor(option.value)"
                >
                  <span><v-icon :icon="option.icon" size="19" /></span>
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                  </span>
                  <v-icon
                    :icon="
                      draft.useAsDefaultFor.includes(option.value)
                        ? 'mdi-check-circle'
                        : 'mdi-circle-outline'
                    "
                    size="18"
                  />
                </button>
              </div>
            </section>
          </div>

          <aside class="preview-panel">
            <header>
              <strong>Audience Preview</strong>
              <span>16:9 presentation</span>
            </header>
            <div class="preview-stage" :style="previewBackgroundStyle">
              <img
                v-if="previewMediaUrl && previewMediaItem?.kind === 'image'"
                :src="previewMediaUrl"
                class="preview-background"
                alt=""
              />
              <video
                v-else-if="previewMediaUrl && previewMediaItem?.kind === 'video'"
                :src="previewMediaUrl"
                class="preview-background"
                autoplay
                loop
                muted
                playsinline
              />
              <div
                class="preview-text"
                :style="{
                  color: draft.textColor,
                  fontFamily: draft.font,
                  textShadow: presentationTextShadow(draft.textEffect),
                }"
              >
                Great are You, Lord<br />Great are You, Lord
              </div>
            </div>
            <p>
              Defaults apply automatically. Choose a different theme from a service item’s
              Presentation settings when needed.
            </p>
          </aside>
        </div>
      </section>

      <section v-else class="editor-empty">
        <span><v-icon icon="mdi-palette-outline" size="32" /></span>
        <h2>Select or create a theme</h2>
        <p>Presentation themes give generated slides a consistent visual identity.</p>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTheme">
          New Theme
        </v-btn>
      </section>
    </section>
    <MediaPickerDialog
      v-model="mediaPickerOpen"
      purpose="background"
      @select="chooseMediaBackground"
    />
  </main>
</template>

<style scoped>
.themes-page {
  max-width: 1420px;
  margin: 0 auto;
  padding: 30px 34px 56px;
}
.themes-hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 23px;
}
.themes-hero > div > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.themes-hero h1 {
  margin: 3px 0 5px;
  font-size: 2rem;
  line-height: 1.1;
}
.themes-hero p {
  max-width: 720px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.82rem;
}
.theme-workspace {
  display: grid;
  min-height: 680px;
  grid-template-columns: 280px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 13px;
  background: rgba(var(--v-theme-surface), 0.7);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.07);
}
.theme-directory {
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-background), 0.24);
}
.theme-directory > header {
  padding: 18px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.theme-directory > header div {
  display: flex;
  flex-direction: column;
}
.theme-directory > header strong {
  font-size: 0.82rem;
}
.theme-directory > header span,
.theme-card small {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.66rem;
}
.theme-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px;
}
.theme-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.theme-card:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
}
.theme-card--active {
  border-color: rgba(var(--v-theme-primary), 0.26);
  background: rgba(var(--v-theme-primary), 0.09);
}
.theme-swatch {
  width: 42px;
  height: 28px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 7px;
}
.theme-card-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.theme-card-copy strong {
  overflow: hidden;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.directory-empty,
.editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
}
.directory-empty {
  min-height: 260px;
  padding: 20px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.directory-empty strong {
  margin: 10px 0 4px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.76rem;
}
.directory-empty span {
  font-size: 0.68rem;
}
.theme-editor {
  min-width: 0;
}
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 17px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.editor-heading > div {
  min-width: 0;
}
.editor-heading > div > span {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.theme-name-field {
  max-width: 520px;
  margin-top: -2px;
}
.theme-name-field :deep(input) {
  padding: 0;
  font-size: 1.25rem;
  font-weight: 720;
}
.editor-layout {
  display: grid;
  grid-template-columns: minmax(440px, 1fr) minmax(300px, 0.7fr);
  align-items: start;
  gap: 17px;
  padding: 18px;
}
.editor-settings {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 13px;
}
.editor-section,
.preview-panel {
  padding: 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.085);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.22);
}
.editor-section > header {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}
.section-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.editor-section h2 {
  margin: 0;
  font-size: 0.82rem;
}
.editor-section header p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.47);
  font-size: 0.67rem;
}
.theme-color-field {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
}
.theme-color-field input[type='color'] {
  width: 46px;
  height: 44px;
  padding: 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.13);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.42);
  cursor: pointer;
}
.theme-color-field input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.theme-color-field input[type='color']::-webkit-color-swatch {
  border: 0;
  border-radius: 5px;
}
.media-background-field {
  margin-top: 12px;
}
.selected-background,
.choose-background {
  display: grid;
  width: 100%;
  grid-template-columns: 92px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 11px;
  padding: 9px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.22);
}
.selected-background-preview {
  display: grid;
  width: 92px;
  aspect-ratio: 16 / 9;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.selected-background-preview img,
.selected-background-preview video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.selected-background-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.selected-background-copy strong {
  overflow: hidden;
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selected-background-copy span {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.64rem;
}
.choose-background {
  grid-template-columns: 38px minmax(0, 1fr) auto;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.choose-background:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.055);
}
.choose-background > span:first-child {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.choose-background > span:nth-child(2) {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.choose-background strong {
  font-size: 0.73rem;
}
.choose-background small {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.64rem;
}
.text-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}
.text-effect-settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
  margin-top: 13px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.text-effect-settings > p {
  grid-column: 1 / -1;
  margin: -2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.66rem;
}
.text-effect-settings .theme-color-field {
  min-width: 0;
}
.default-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.default-grid button {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.2);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.default-grid button.selected {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.075);
  color: rgb(var(--v-theme-primary));
}
.default-grid button > span:first-child {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 7px;
  background: rgba(var(--v-theme-on-surface), 0.055);
}
.default-grid button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.default-grid strong {
  font-size: 0.72rem;
}
.default-grid small {
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.61rem;
  line-height: 1.35;
}
.preview-panel {
  position: sticky;
  top: 16px;
}
.preview-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.preview-panel > header strong {
  font-size: 0.76rem;
}
.preview-panel > header span {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.62rem;
}
.preview-stage {
  position: relative;
  display: flex;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 20px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  border-radius: 8px;
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
  font-size: clamp(16px, 1.8vw, 26px);
  font-weight: 700;
  line-height: 1.4;
}
.preview-panel > p {
  margin: 11px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.66rem;
  line-height: 1.5;
}
.editor-empty {
  min-height: 620px;
}
.editor-empty > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.editor-empty h2 {
  margin: 14px 0 4px;
  font-size: 1rem;
}
.editor-empty p {
  margin: 0 0 17px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.74rem;
}
@media (max-width: 1050px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
  .preview-panel {
    position: static;
  }
}
@media (max-width: 760px) {
  .themes-page {
    padding: 22px 16px 42px;
  }
  .themes-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .themes-hero .v-btn {
    align-self: flex-start;
  }
  .theme-workspace {
    grid-template-columns: 1fr;
  }
  .theme-directory {
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  }
  .editor-layout,
  .text-fields,
  .text-effect-settings,
  .default-grid {
    grid-template-columns: 1fr;
  }
}
</style>
