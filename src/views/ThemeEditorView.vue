<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRaw, watch } from 'vue'
import { useThemesStore } from '@/stores/themes'
import { useMediaStore } from '@/stores/media'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { Theme } from '@/models/library'

const store = useThemesStore()
const mediaStore = useMediaStore()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()

// Themes are edited in place on this one screen (no per-theme route like Songs/Slides have)
// — switching the selected theme, rather than navigating away, is what risks silently
// discarding an edit, so that's what needs its own confirm rather than the router guard.
const selectedId = ref<string>()
const draft = ref<Theme>()
const dirty = ref(false)

const fontOptions = ['Inter', 'Georgia', 'Montserrat']
const defaultForOptions: { value: Theme['useAsDefaultFor'][number]; label: string }[] = [
  { value: 'songs', label: 'Songs' },
  { value: 'scripture', label: 'Scripture' },
  { value: 'announcements', label: 'Announcements' },
  { value: 'welcome-closing', label: 'Welcome/Closing' },
]

onMounted(async () => {
  await Promise.all([store.load(), mediaStore.load(), settingsStore.load()])
  // Guarded on `draft` still being unset: without this, clicking "New Theme" while this load
  // is still in flight (a slow disk/sync folder, or just unlucky timing) gets silently
  // clobbered the instant it resolves, replacing the fresh draft with whatever theme happens
  // to load first.
  if (draft.value) return
  const first = store.themes[0]
  if (first) selectTheme(first.id)
})

function blankTheme(): Theme {
  return {
    id: `theme-${crypto.randomUUID()}`,
    name: 'New Theme',
    font: 'Inter',
    textColor: '#FFFFFF',
    outline: true,
    useAsDefaultFor: [],
    updatedAt: '',
    updatedByDevice: '',
  }
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!dirty.value) return true
  return confirmDialog.confirm('Discard unsaved theme changes?', 'Leave Without Saving')
}

async function selectTheme(id: string) {
  if (!(await confirmDiscardIfDirty())) return
  const theme = store.themes.find((t) => t.id === id)
  selectedId.value = id
  draft.value = theme ? structuredClone(toRaw(theme)) : undefined
  // Reassigning `draft` itself (not a nested edit) still triggers the deep watch below, on
  // the next reactivity flush — awaiting that flush first, then clearing dirty, is what makes
  // this the one that actually sticks; otherwise selecting an untouched existing theme left it
  // spuriously marked dirty moments later.
  await nextTick()
  dirty.value = false
}

async function createTheme() {
  if (!(await confirmDiscardIfDirty())) return
  const theme = blankTheme()
  selectedId.value = theme.id
  draft.value = theme
  dirty.value = true
}

// Registered once (not inside an async onMounted) so it's tied to this component's whole
// lifetime without the stop-handle dance the per-route editors need — see SongEditorView.
watch(draft, () => (dirty.value = true), { deep: true })

async function saveDraft() {
  if (!draft.value) return
  await store.save(draft.value)
  selectedId.value = draft.value.id
  dirty.value = false
}

async function deleteTheme(id: string) {
  if (selectedId.value === id) {
    draft.value = undefined
    selectedId.value = undefined
    dirty.value = false
  }
  await store.remove(id)
}

function toggleDefaultFor(value: Theme['useAsDefaultFor'][number]) {
  if (!draft.value) return
  const list = draft.value.useAsDefaultFor
  const index = list.indexOf(value)
  if (index === -1) list.push(value)
  else list.splice(index, 1)
}

const brandPrimary = computed(() => settingsStore.librarySettings?.branding.primaryColor ?? '#3B5BDB')
const brandSecondary = computed(() => settingsStore.librarySettings?.branding.secondaryColor ?? '#8A5BD6')

function isMediaBackground(id: string | undefined): id is string {
  return !!id && id !== 'brand-primary' && id !== 'brand-secondary'
}

const mediaBackgroundOptions = computed(() => mediaStore.items.map((item) => ({ title: item.filename, value: item.id })))

const previewBackgroundStyle = computed(() => {
  const id = draft.value?.backgroundId
  if (!id) return { background: '#1c2333' }
  if (id === 'brand-primary') return { background: brandPrimary.value }
  if (id === 'brand-secondary') return { background: brandSecondary.value }
  // Real image/video previews aren't rendered here (see MediaLibraryView) — a placeholder
  // gradient stands in, same as a media card's own thumbnail.
  return { background: 'linear-gradient(135deg, #22262b, #3b5bdb)' }
})

// The sketch offers a fixed White/Brand Primary/Brand Secondary choice rather than a free
// color picker — resolved to (and from) the actual hex value so Theme.textColor stays a
// plain, self-contained string rather than a token that needs the branding config to interpret.
type TextColorToken = 'white' | 'primary' | 'secondary' | 'custom'
function textColorToken(color: string | undefined): TextColorToken {
  if (color === brandPrimary.value) return 'primary'
  if (color === brandSecondary.value) return 'secondary'
  if (color === '#FFFFFF' || !color) return 'white'
  return 'custom'
}
function resolveTextColor(token: TextColorToken) {
  if (!draft.value) return
  if (token === 'primary') draft.value.textColor = brandPrimary.value
  else if (token === 'secondary') draft.value.textColor = brandSecondary.value
  else draft.value.textColor = '#FFFFFF'
}
</script>

<template>
  <div class="theme-editor">
    <div class="theme-panel">
      <div class="text-overline text-medium-emphasis pa-3">Themes</div>
      <v-list density="compact" nav class="pa-0 flex-grow-1" style="overflow-y: auto">
        <v-list-item
          v-for="theme in store.themes"
          :key="theme.id"
          :active="selectedId === theme.id"
          rounded="lg"
          @click="selectTheme(theme.id)"
        >
          <template #prepend>
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
                        : '#1c2333',
              }"
            />
          </template>
          {{ theme.name }}
          <template #append>
            <v-btn icon="mdi-trash-can-outline" variant="text" size="small" @click.stop="deleteTheme(theme.id)" />
          </template>
        </v-list-item>
      </v-list>
      <v-btn variant="outlined" class="ma-3" prepend-icon="mdi-plus" @click="createTheme">New Theme</v-btn>
    </div>

    <div v-if="draft" class="editor-panel">
      <v-text-field v-model="draft.name" variant="underlined" density="comfortable" class="text-h6 font-weight-bold mb-4" hide-details />

      <div class="text-overline text-medium-emphasis mb-2">Background</div>
      <div class="d-flex ga-3 mb-6 align-center flex-wrap">
        <div
          class="bg-swatch"
          :class="{ selected: draft.backgroundId === 'brand-primary' }"
          :style="{ background: brandPrimary }"
          title="Brand Primary"
          @click="draft.backgroundId = 'brand-primary'"
        />
        <div
          class="bg-swatch"
          :class="{ selected: draft.backgroundId === 'brand-secondary' }"
          :style="{ background: brandSecondary }"
          title="Brand Secondary"
          @click="draft.backgroundId = 'brand-secondary'"
        />
        <v-select
          :model-value="isMediaBackground(draft.backgroundId) ? draft.backgroundId : null"
          :items="mediaBackgroundOptions"
          label="From Media Library…"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          style="max-width: 220px"
          @update:model-value="(v) => (draft!.backgroundId = v ?? undefined)"
        />
      </div>

      <div class="text-overline text-medium-emphasis mb-2">Text</div>
      <div class="d-flex ga-4 mb-2">
        <v-select v-model="draft.font" :items="fontOptions" label="Font" variant="outlined" density="compact" style="max-width: 200px" />
        <v-select
          :model-value="textColorToken(draft.textColor)"
          :items="[
            { title: 'White', value: 'white' },
            { title: 'Brand Primary', value: 'primary' },
            { title: 'Brand Secondary', value: 'secondary' },
          ]"
          label="Text Color"
          variant="outlined"
          density="compact"
          style="max-width: 200px"
          @update:model-value="resolveTextColor"
        />
      </div>

      <div class="d-flex align-center justify-space-between py-3">
        <div>
          <div class="font-weight-bold text-body-2">Text Outline</div>
          <div class="text-caption text-medium-emphasis">Keeps text readable over image/video backgrounds</div>
        </div>
        <v-switch v-model="draft.outline" color="primary" hide-details />
      </div>

      <div class="text-overline text-medium-emphasis mb-2 mt-4">Use As Default For</div>
      <div class="d-flex ga-2 flex-wrap">
        <v-chip
          v-for="option in defaultForOptions"
          :key="option.value"
          :color="draft.useAsDefaultFor.includes(option.value) ? 'primary' : undefined"
          :variant="draft.useAsDefaultFor.includes(option.value) ? 'flat' : 'outlined'"
          @click="toggleDefaultFor(option.value)"
        >
          {{ option.label }}
        </v-chip>
      </div>

      <v-btn variant="flat" color="primary" class="mt-6" :disabled="!dirty" @click="saveDraft">Save Theme</v-btn>
    </div>
    <div v-else class="editor-panel">
      <p class="text-medium-emphasis">No themes yet — create one to get started.</p>
    </div>

    <div class="preview-panel">
      <div class="text-overline text-medium-emphasis mb-3">Live Preview</div>
      <div v-if="draft" class="preview-stage" :style="previewBackgroundStyle">
        <div
          class="preview-text"
          :style="{
            color: draft.textColor,
            fontFamily: draft.font,
            textShadow: draft.outline ? '0 0 4px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.8)' : 'none',
          }"
        >
          Great are You, Lord<br />Great are You, Lord
        </div>
      </div>
      <p class="text-caption text-medium-emphasis mt-3">
        Updates as background, font, and text settings change — shown with a sample lyric.
      </p>
    </div>
  </div>
</template>

<style scoped>
.theme-editor {
  display: grid;
  grid-template-columns: 220px 1fr 340px;
  min-height: calc(100vh - 49px);
}
.theme-panel {
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: flex;
  flex-direction: column;
}
.editor-panel {
  padding: 24px 28px;
  max-width: 640px;
}
.preview-panel {
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 20px;
}
.preview-stage {
  border-radius: 10px;
  aspect-ratio: 16 / 9;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  text-align: center;
}
.preview-text {
  font-size: clamp(16px, 2vw, 22px);
  font-weight: 700;
  line-height: 1.4;
}
.theme-swatch {
  width: 24px;
  height: 16px;
  border-radius: 3px;
  display: inline-block;
}
.bg-swatch {
  width: 56px;
  height: 36px;
  border-radius: 6px;
  border: 2px solid rgba(var(--v-border-color), var(--v-border-opacity));
  cursor: pointer;
}
.bg-swatch.selected {
  border-color: rgb(var(--v-theme-primary));
}
</style>
