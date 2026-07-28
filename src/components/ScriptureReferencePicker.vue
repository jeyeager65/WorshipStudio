<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { getAdapter } from '@/adapters'
import { formatReference, getBookNames, getChapterCount, getVerseCount, isValidReference, parseReference } from '@/utils/scriptureReference'
import type { ScriptureReference } from '@/models/scripture'
import type { ScripturePassage, ScriptureTranslation } from '@/adapters/types'

export interface ScriptureReferenceValue {
  reference: string
  translation: string
  displayMode: 'full' | 'reference-only'
}

// Shared by the Scripture add-tab (one instance) and the Sermon add-tab's passages list (N
// instances, one per passage) — same "type a reference, or choose fields" picker either way,
// with a live preview of the resolved verse text. Emits its current value continuously as the
// operator edits it; `isValid`/`resolvedPassage`/`hasError` are exposed (not emitted) so a
// parent can gate its own "Add" button and seed a scripture-cache map on submit, same as before
// this was extracted out of ServiceWorkspaceView.vue.
const props = defineProps<{ modelValue: ScriptureReferenceValue; translations: ScriptureTranslation[] }>()
const emit = defineEmits<{ 'update:modelValue': [ScriptureReferenceValue] }>()

// A rejected Tauri invoke() surfaces its Rust Err(String) payload as a plain JS string, not an
// Error instance — `e instanceof Error` is always false for it, silently discarding the real
// message in favor of a generic fallback.
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return fallback
}

const entryMode = ref<'type' | 'fields'>('type')
const refText = ref(props.modelValue.reference)
const book = ref<string>()
const startChapter = ref<number>()
const startVerse = ref<number>()
const endChapter = ref<number>()
const endVerse = ref<number>()
const displayMode = ref<'full' | 'reference-only'>(props.modelValue.displayMode)
const translationCode = ref<string | undefined>(props.modelValue.translation || undefined)
const preview = ref<ScripturePassage>()
const previewText = computed(() => (preview.value ? preview.value.verses.map((v) => `${v.number} ${v.text}`).join(' ') : ''))
const previewError = ref<string>()
const previewLoading = ref(false)

const bookNames = getBookNames()

onMounted(() => {
  if (!translationCode.value && props.translations.length > 0) translationCode.value = props.translations[0].code
})

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i)
}
const startChapterOptions = computed(() => (book.value ? range(1, getChapterCount(book.value)) : []))
const startVerseOptions = computed(() => (book.value && startChapter.value ? range(1, getVerseCount(book.value, startChapter.value)) : []))
const endChapterOptions = computed(() => (book.value && startChapter.value ? range(startChapter.value, getChapterCount(book.value)) : []))
const endVerseOptions = computed(() => {
  if (!book.value || !endChapter.value) return []
  const minVerse = endChapter.value === startChapter.value ? (startVerse.value ?? 1) : 1
  return range(minVerse, getVerseCount(book.value, endChapter.value))
})

// Picking a new book/start point resets anything downstream that could now be invalid, and
// defaults the end of the range to match the start (a single verse) so "Choose fields" always
// represents a complete, addable reference as soon as a start verse is picked.
watch(book, () => {
  startChapter.value = undefined
  startVerse.value = undefined
  endChapter.value = undefined
  endVerse.value = undefined
})
watch(startChapter, (chapter) => {
  startVerse.value = undefined
  endChapter.value = chapter
  endVerse.value = undefined
})
watch(startVerse, (verse) => {
  endVerse.value = verse
})
watch(endChapter, () => {
  endVerse.value = undefined
})

const activeReference = computed<ScriptureReference | undefined>(() => {
  if (entryMode.value === 'type') return parseReference(refText.value)
  if (!book.value || !startChapter.value || !startVerse.value) return undefined
  return {
    book: book.value,
    startChapter: startChapter.value,
    startVerse: startVerse.value,
    endChapter: endChapter.value ?? startChapter.value,
    endVerse: endVerse.value ?? startVerse.value,
  }
})
const isValid = computed(() => !!activeReference.value && isValidReference(activeReference.value))
const activeReferenceText = computed(() => (activeReference.value ? formatReference(activeReference.value) : ''))

// Live preview, re-fetched whenever the resolved reference/translation changes. A request
// token guards against an in-flight fetch for a since-superseded reference overwriting a
// newer one's result.
let previewToken = 0
watch([activeReferenceText, translationCode, displayMode], async () => {
  preview.value = undefined
  previewError.value = undefined
  if (displayMode.value === 'reference-only' || !isValid.value || !translationCode.value) return
  const token = ++previewToken
  previewLoading.value = true
  try {
    const passage = await getAdapter().scripture.resolve(activeReferenceText.value, translationCode.value)
    if (token === previewToken) preview.value = passage
  } catch (e) {
    if (token === previewToken) previewError.value = errorMessage(e, 'Failed to load passage.')
  } finally {
    if (token === previewToken) previewLoading.value = false
  }
})

watch([activeReferenceText, translationCode, displayMode], () => {
  emit('update:modelValue', { reference: activeReferenceText.value, translation: translationCode.value ?? '', displayMode: displayMode.value })
})

defineExpose({
  isValid,
  resolvedPassage: computed(() => preview.value),
  hasError: computed(() => !!previewError.value),
})
</script>

<template>
  <div>
    <v-btn-toggle v-model="entryMode" mandatory density="compact" divided class="mb-4">
      <v-btn value="type" size="small">Type a Reference</v-btn>
      <v-btn value="fields" size="small">Choose Fields</v-btn>
    </v-btn-toggle>

    <v-text-field
      v-if="entryMode === 'type'"
      v-model="refText"
      label="Reference"
      placeholder="e.g. John 3:16-17"
      variant="outlined"
      density="comfortable"
      autofocus
      :error="!!refText && !isValid"
      :error-messages="refText && !isValid ? ['Not a recognized reference'] : []"
    />

    <template v-else>
      <v-select v-model="book" :items="bookNames" label="Book" variant="outlined" density="comfortable" />
      <div class="d-flex ga-3">
        <v-select
          v-model="startChapter"
          :items="startChapterOptions"
          label="Start Chapter"
          variant="outlined"
          density="comfortable"
          :disabled="!book"
        />
        <v-select
          v-model="startVerse"
          :items="startVerseOptions"
          label="Start Verse"
          variant="outlined"
          density="comfortable"
          :disabled="!startChapter"
        />
      </div>
      <div class="d-flex ga-3">
        <v-select
          v-model="endChapter"
          :items="endChapterOptions"
          label="End Chapter"
          variant="outlined"
          density="comfortable"
          :disabled="!startChapter"
        />
        <v-select
          v-model="endVerse"
          :items="endVerseOptions"
          label="End Verse"
          variant="outlined"
          density="comfortable"
          :disabled="!endChapter"
        />
      </div>
    </template>

    <v-btn-toggle v-model="displayMode" mandatory density="compact" divided class="my-3">
      <v-btn value="full" size="small">Show Full Text</v-btn>
      <v-btn value="reference-only" size="small">Reference Only</v-btn>
    </v-btn-toggle>

    <v-select
      v-if="displayMode === 'full'"
      v-model="translationCode"
      :items="translations"
      item-title="name"
      item-value="code"
      label="Translation"
      variant="outlined"
      density="comfortable"
    />

    <div v-if="displayMode === 'full'" class="mb-2" style="min-height: 24px">
      <span v-if="previewLoading" class="text-medium-emphasis text-body-2">Loading preview…</span>
      <span v-else-if="previewError" class="text-error text-body-2">{{ previewError }}</span>
      <div v-else-if="preview">
        <div class="text-caption text-medium-emphasis mb-1">{{ preview.reference }} ({{ preview.translation }})</div>
        <p class="text-body-2">{{ previewText }}</p>
      </div>
    </div>
    <p v-else-if="isValid" class="text-body-2 text-medium-emphasis mb-2">{{ activeReferenceText }} — reference only, no verse text shown.</p>
  </div>
</template>
