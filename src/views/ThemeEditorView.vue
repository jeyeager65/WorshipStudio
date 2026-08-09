<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getAdapter } from '@/adapters'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import type { PresentationThemeTarget, Theme } from '@/models/library'
import {
  normalizePresentationThemeTarget,
  presentationThemeAppliesTo,
  presentationThemeDefaults,
} from '@/utils/presentationTheme'
import {
  bundledPresentationFonts,
  cssFontFamily,
  resolvePresentationFontFamily,
} from '@/utils/presentationFonts'
import {
  DEFAULT_PRESENTATION_TEXT_EFFECT,
  presentationTextEffect,
  presentationTextShadow,
} from '@/utils/presentationTextEffect'

const store = useThemesStore()
const mediaStore = useMediaStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()
const route = useRoute()
const router = useRouter()
const { isDirty, saving, saveHandler, pageTitleOverride } = storeToRefs(useUnsavedChangesStore())

const draft = ref<Theme>()
const editorLoading = ref(true)
const editorLoadError = ref('')
const documentHistory = useDocumentHistory(draft, 'theme')
const previewDialogOpen = ref(false)
const amazingGracePreview = [
  'Amazing grace! how sweet the sound',
  'That saved a wretch like me!',
  'I once was lost, but now am found,',
  'Was blind, but now I see.',
]

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
const applicableDefaultOptions = computed(() => {
  if (!draft.value?.appliesTo?.length) return defaultForOptions
  return defaultForOptions.filter((option) => draft.value!.appliesTo!.includes(option.value))
})

onMounted(loadEditor)

async function loadEditor() {
  saveHandler.value = saveDraft
  pageTitleOverride.value = 'Presentation Theme'
  editorLoading.value = true
  editorLoadError.value = ''
  const [themesLoaded, mediaLoaded, settingsLoaded] = await Promise.all([
    store.load(),
    mediaStore.load(),
    settingsStore.load(),
  ])
  if (!themesLoaded || !mediaLoaded || !settingsLoaded) {
    editorLoadError.value = store.loadError || mediaStore.loadError || settingsStore.loadError
    editorLoading.value = false
    return
  }
  const id = String(route.params.id)
  if (id === 'new') {
    draft.value = blankTheme()
    await nextTick()
    isDirty.value = true
    documentHistory.start((dirty) => (isDirty.value = dirty), true)
    editorLoading.value = false
    return
  }
  const theme = store.themes.find((candidate) => candidate.id === id)
  if (theme) await loadTheme(theme)
  else editorLoadError.value = 'That theme could not be found. It may have been moved or deleted.'
  if (draft.value) documentHistory.start((dirty) => (isDirty.value = dirty))
  editorLoading.value = false
}

onUnmounted(() => {
  documentHistory.stop()
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
    appliesTo: [],
    useAsDefaultFor: [],
    updatedAt: '',
    updatedByDevice: '',
  }
}

async function loadTheme(theme: Theme) {
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
  draft.value = {
    ...next,
    appliesTo: presentationThemeAppliesTo(theme),
    useAsDefaultFor: presentationThemeDefaults(theme),
  }
  await nextTick()
  isDirty.value = false
}

async function saveDraft() {
  if (!draft.value || saving.value) return
  const name = draft.value.name.trim()
  if (!name) return
  draft.value.name = name
  draft.value.textEffect = presentationTextEffect(draft.value)
  // Keep older Worship Studio versions' switch meaningful when they read the same theme.
  draft.value.outline = draft.value.textEffect.type === 'outline'
  const normalizedApplicability = new Set<PresentationThemeTarget>()
  for (const target of (draft.value.appliesTo ?? []) as string[]) {
    const normalized = normalizePresentationThemeTarget(target)
    if (normalized) normalizedApplicability.add(normalized)
  }
  draft.value.appliesTo = [...normalizedApplicability]
  // Only one default may own a content type. This makes resolution deterministic and turns
  // selecting a default here into the expected reassignment rather than an ambiguous tie.
  const normalizedTargets = new Set<PresentationThemeTarget>()
  for (const target of draft.value.useAsDefaultFor as string[]) {
    const normalized = normalizePresentationThemeTarget(target)
    if (normalized) normalizedTargets.add(normalized)
  }
  draft.value.useAsDefaultFor = [...normalizedTargets]
  if (draft.value.appliesTo.length)
    draft.value.useAsDefaultFor = draft.value.useAsDefaultFor.filter((target) =>
      draft.value!.appliesTo!.includes(target),
    )
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
    isDirty.value = false
    if (route.params.id === 'new')
      await router.replace({ name: 'theme-editor', params: { id: draft.value.id } })
  } finally {
    saving.value = false
  }
}

async function deleteTheme() {
  if (!draft.value) return
  const name = draft.value.name || 'this theme'
  if (!(await confirmDialog.confirm(`Delete "${name}"? This can't be undone.`, 'Delete'))) return
  await store.remove(draft.value.id)
  isDirty.value = false
  await router.push({ name: 'theme-library' })
}

function toggleDefaultFor(value: PresentationThemeTarget) {
  if (!draft.value) return
  const list = draft.value.useAsDefaultFor
  const index = list.indexOf(value)
  if (index === -1) list.push(value)
  else list.splice(index, 1)
}

function toggleAppliesTo(value: PresentationThemeTarget) {
  if (!draft.value) return
  const list = draft.value.appliesTo ?? (draft.value.appliesTo = [])
  const index = list.indexOf(value)
  if (index === -1) list.push(value)
  else {
    if (list.length === 1) return
    list.splice(index, 1)
    const defaultIndex = draft.value.useAsDefaultFor.indexOf(value)
    if (defaultIndex !== -1) draft.value.useAsDefaultFor.splice(defaultIndex, 1)
  }
}

function setThemeScope(scope: 'generic' | 'specific') {
  if (!draft.value) return
  if (scope === 'generic') draft.value.appliesTo = []
  else if (!draft.value.appliesTo?.length)
    draft.value.appliesTo = defaultForOptions.map((option) => option.value)
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
    if (!isMediaBackground(id)) return
    try {
      // getFilePath is Tauri-only; getPreviewUrl is implemented by every adapter (mock, web) as
      // the fallback rather than silently never previewing a background there.
      const adapter = getAdapter()
      const url = adapter.media.getFilePath
        ? convertFileSrc(await adapter.media.getFilePath(id))
        : await adapter.media.getPreviewUrl(id)
      if (request === previewMediaRequest && url) previewMediaUrl.value = url
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
        <v-btn
          :to="{ name: 'theme-library' }"
          variant="text"
          prepend-icon="mdi-arrow-left"
          class="back-button"
        >
          Presentation Themes
        </v-btn>
        <span>Theme Editor</span>
        <h1>{{ draft?.name.trim() || 'New Presentation Theme' }}</h1>
        <p>Configure the background and text styling used for generated audience slides.</p>
      </div>
      <v-btn
        v-if="route.params.id !== 'new'"
        variant="text"
        color="error"
        prepend-icon="mdi-delete-outline"
        @click="deleteTheme"
      >
        Delete Theme
      </v-btn>
    </header>

    <section class="theme-workspace">
      <AsyncLoadState
        v-if="!draft"
        :loading="editorLoading"
        :error="editorLoadError"
        label="presentation theme"
        @retry="loadEditor"
      />
      <v-alert
        v-else-if="store.mutationError"
        type="error"
        variant="tonal"
        closable
        class="mb-4"
        @click:close="store.clearMutationError"
      >
        Theme changes were not saved: {{ store.mutationError }}
      </v-alert>
      <section v-if="draft" class="theme-editor">
        <div class="editor-layout">
          <div class="editor-settings">
            <section class="editor-section">
              <header>
                <span class="section-icon"><v-icon icon="mdi-palette-outline" size="20" /></span>
                <div>
                  <h2>Theme Details</h2>
                  <p>Name this theme so it is easy to recognize when choosing an override.</p>
                </div>
              </header>
              <v-text-field
                v-model="draft.name"
                label="Theme name"
                placeholder="e.g. Sunday Worship"
                variant="outlined"
                density="comfortable"
                hide-details
                class="theme-name-field"
              />
            </section>

            <section class="editor-section">
              <header>
                <span class="section-icon"><v-icon icon="mdi-shape-outline" size="20" /></span>
                <div>
                  <h2>Theme Uses</h2>
                  <p>Control where this theme appears and optionally make it a default.</p>
                </div>
              </header>
              <div class="theme-scope-options">
                <button
                  type="button"
                  :class="{ selected: !draft.appliesTo?.length }"
                  @click="setThemeScope('generic')"
                >
                  <span><v-icon icon="mdi-view-grid-outline" size="19" /></span>
                  <span>
                    <strong>Generic</strong>
                    <small>Available for every generated content type</small>
                  </span>
                  <v-icon
                    :icon="!draft.appliesTo?.length ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'"
                    size="19"
                  />
                </button>
                <button
                  type="button"
                  :class="{ selected: !!draft.appliesTo?.length }"
                  @click="setThemeScope('specific')"
                >
                  <span><v-icon icon="mdi-filter-variant" size="19" /></span>
                  <span>
                    <strong>Specific content types</strong>
                    <small>Only show this theme where you choose</small>
                  </span>
                  <v-icon
                    :icon="draft.appliesTo?.length ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'"
                    size="19"
                  />
                </button>
              </div>
              <div v-if="draft.appliesTo?.length" class="theme-use-group">
                <div class="theme-use-group-heading">
                  <strong>Available for</strong>
                  <span>Select at least one content type.</span>
                </div>
                <div class="theme-use-choices">
                  <label
                    v-for="option in defaultForOptions"
                    :key="option.value"
                    :class="{ selected: draft.appliesTo.includes(option.value) }"
                  >
                    <v-checkbox-btn
                      :model-value="draft.appliesTo.includes(option.value)"
                      color="primary"
                      :aria-label="`Make theme available for ${option.label}`"
                      @update:model-value="toggleAppliesTo(option.value)"
                    />
                    <span><v-icon :icon="option.icon" size="17" />{{ option.label }}</span>
                  </label>
                </div>
              </div>
              <div class="theme-use-group default-use-group">
                <div class="theme-use-group-heading">
                  <strong>Use as default <em>Optional</em></strong>
                  <span>A content type can only have one default theme.</span>
                </div>
                <div class="theme-use-choices">
                  <label
                    v-for="option in applicableDefaultOptions"
                    :key="option.value"
                    :class="{ selected: draft.useAsDefaultFor.includes(option.value) }"
                  >
                    <v-checkbox-btn
                      :model-value="draft.useAsDefaultFor.includes(option.value)"
                      color="primary"
                      :aria-label="`Use theme as default for ${option.label}`"
                      @update:model-value="toggleDefaultFor(option.value)"
                    />
                    <span><v-icon :icon="option.icon" size="17" />{{ option.label }}</span>
                  </label>
                </div>
              </div>
            </section>

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
          </div>

          <aside class="preview-panel">
            <header>
              <strong>Audience Preview</strong>
              <span>16:9 presentation</span>
            </header>
            <button
              type="button"
              class="preview-stage"
              :style="previewBackgroundStyle"
              aria-label="Open larger theme preview"
              @click="previewDialogOpen = true"
            >
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
                  fontFamily: cssFontFamily(draft.font),
                  textShadow: presentationTextShadow(draft.textEffect),
                }"
              >
                <span v-for="line in amazingGracePreview" :key="line">{{ line }}</span>
              </div>
              <span class="preview-expand"><v-icon icon="mdi-arrow-expand" size="17" /></span>
            </button>
            <p>
              Defaults apply automatically. Choose a different theme from a service item’s
              Presentation settings when needed.
            </p>
          </aside>
        </div>
      </section>

      <section v-else class="editor-empty">
        <span><v-icon icon="mdi-palette-outline" size="32" /></span>
        <h2>Theme Not Found</h2>
        <p>This presentation theme may have been deleted or moved.</p>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-arrow-left"
          :to="{ name: 'theme-library' }"
        >
          Back to Themes
        </v-btn>
      </section>
    </section>
    <MediaPickerDialog
      v-model="mediaPickerOpen"
      purpose="background"
      @select="chooseMediaBackground"
    />

    <v-dialog v-model="previewDialogOpen" max-width="1180">
      <v-card class="preview-dialog-card">
        <v-card-title class="preview-dialog-title">
          <div>
            <strong>{{ draft?.name || 'Theme Preview' }}</strong>
            <span>Audience preview · 16:9</span>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            aria-label="Close preview"
            @click="previewDialogOpen = false"
          />
        </v-card-title>
        <v-card-text v-if="draft" class="preview-dialog-content">
          <div class="preview-stage preview-stage--large" :style="previewBackgroundStyle">
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
                fontFamily: cssFontFamily(draft.font),
                textShadow: presentationTextShadow(draft.textEffect),
              }"
            >
              <span v-for="line in amazingGracePreview" :key="line">{{ line }}</span>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
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
.back-button {
  display: flex;
  width: fit-content;
  margin: 0 0 8px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  text-transform: none;
}
.theme-workspace {
  min-height: 680px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 13px;
  background: rgba(var(--v-theme-surface), 0.7);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.07);
}
.editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
}
.theme-editor {
  min-width: 0;
}
.theme-name-field {
  max-width: 520px;
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
  align-items: start;
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
.theme-scope-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.theme-scope-options button {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.2);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.theme-scope-options button:hover {
  border-color: rgba(var(--v-theme-primary), 0.24);
}
.theme-scope-options button.selected {
  border-color: rgba(var(--v-theme-primary), 0.38);
  background: rgba(var(--v-theme-primary), 0.075);
}
.theme-scope-options button > span:first-child {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 7px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.theme-scope-options button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.theme-scope-options strong {
  font-size: 0.72rem;
}
.theme-scope-options small,
.theme-use-group-heading span {
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.61rem;
  line-height: 1.35;
}
.theme-use-group {
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.075);
}
.theme-use-group-heading {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.theme-use-group-heading strong {
  font-size: 0.7rem;
}
.theme-use-group-heading em {
  margin-left: 5px;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.54rem;
  font-style: normal;
  font-weight: 700;
  text-transform: uppercase;
}
.theme-use-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.theme-use-choices label {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 38px;
  padding: 5px 9px 5px 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.16);
  cursor: pointer;
  text-align: left;
}
.theme-use-choices :deep(.v-selection-control) {
  flex: 0 0 auto;
}
.theme-use-choices label.selected {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.055);
}
.theme-use-choices label > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.68rem;
  font-weight: 650;
  text-align: left;
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
  container-type: inline-size;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  width: 100%;
  overflow: hidden;
  padding: 20px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: center;
}
.preview-stage:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.08);
}
.preview-stage:focus-visible {
  border-color: rgb(var(--v-theme-primary));
  outline: 2px solid rgba(var(--v-theme-primary), 0.4);
  outline-offset: 2px;
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
  font-size: clamp(12px, 4.5cqw, 26px);
  font-weight: 700;
  line-height: 1.4;
}
.preview-text span {
  white-space: nowrap;
}
.preview-expand {
  position: absolute;
  z-index: 2;
  top: 9px;
  right: 9px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.46);
  color: #fff;
  opacity: 0.78;
}
.preview-stage:hover .preview-expand,
.preview-stage:focus-visible .preview-expand {
  opacity: 1;
}
.preview-dialog-card {
  overflow: hidden;
  border-radius: 12px;
}
.preview-dialog-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 17px;
}
.preview-dialog-title > div {
  display: flex;
  flex-direction: column;
}
.preview-dialog-title strong {
  font-size: 0.86rem;
}
.preview-dialog-title span {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.66rem;
}
.preview-dialog-content {
  padding: 0 !important;
}
.preview-stage--large {
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: 0;
  cursor: default;
}
.preview-stage--large:hover {
  border-color: transparent;
  box-shadow: none;
}
.preview-stage--large .preview-text {
  font-size: clamp(24px, 4cqw, 52px);
  line-height: 1.35;
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
  .editor-layout,
  .text-fields,
  .text-effect-settings {
    grid-template-columns: 1fr;
  }
  .theme-scope-options,
  .theme-use-choices {
    grid-template-columns: 1fr;
  }
}
</style>
