<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { useServicesStore } from '@/stores/services'
import { usePeopleStore } from '@/stores/people'
import { useSettingsStore } from '@/stores/settings'
import { useSongsStore } from '@/stores/songs'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useHistoryStore } from '@/stores/history'
import { personFormalName } from '@/models/library'
import type { Service } from '@/models/service'
import {
  applySermonEdit,
  defaultSermonRole,
  findSermonItem,
  sermonMainReference,
  sermonPreacherId,
} from '@/utils/sermonInfo'
import { formatServiceTime } from '@/utils/serviceTime'
import { returnPath, routeWithReturnTo } from '@/utils/returnNavigation'
import { applyServiceTemplate } from '@/utils/serviceTemplate'
import FiveMinuteTimePicker from '@/components/FiveMinuteTimePicker.vue'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import { getAdapter } from '@/adapters'
import ScriptureReferencePicker, {
  type ScriptureReferenceValue,
} from '@/components/ScriptureReferencePicker.vue'
import type { ScriptureTranslation } from '@/adapters/types'
import {
  compactPlanningSongSlots,
  emptyPlanningSongSlot,
  isPlanningSongSlot,
  placePlanningSongInSlot,
} from '@/utils/planningSongs'

const route = useRoute()
const router = useRouter()
const backTo = computed(() => returnPath(route.query.returnTo, '/'))
const backLabel = computed(() => (backTo.value.startsWith('/service/') ? 'Service' : 'Services'))
const servicesStore = useServicesStore()
const peopleStore = usePeopleStore()
const settingsStore = useSettingsStore()
const songsStore = useSongsStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const historyStore = useHistoryStore()
const sermonTitle = ref('')
const passage = ref('')
const preacherId = ref<string>()
const applyingTemplate = ref(false)
const templateToApply = ref<string>()
const serviceDate = ref('')
const serviceTime = ref('')
const serviceType = ref('')
const loadingPlan = ref(true)
const templateDialog = ref(false)
const scriptureDialog = ref(false)
const sermonPassageDialog = ref(false)
const sermonPassageId = ref<string>()
const sermonOutlineDialog = ref(false)
const sermonOutlineId = ref<string>()
const sermonOutlineLabel = ref('')
const sermonOutlineText = ref('')
const scriptureSlotId = ref<string>()
const scriptureDraft = ref<ScriptureReferenceValue>({
  reference: '',
  translation: '',
  displayMode: 'full',
})
const scriptureTranslations = ref<ScriptureTranslation[]>([])
const scripturePickerRef = ref<{ isValid: boolean }>()

const service = ref<Service>()
const documentHistory = useDocumentHistory(service, 'Service Plan')
const preacherOptions = computed(() =>
  peopleStore.people.map((person) => ({ title: personFormalName(person), value: person.id })),
)
const templateOptions = computed(() =>
  (settingsStore.librarySettings?.serviceTemplates ?? []).map((template) => ({
    title: template.serviceType,
    value: template.serviceType,
  })),
)
const assignmentSummary = computed(() => {
  const assignments = service.value?.assignments ?? []
  const assigned = assignments.filter((assignment) => !!assignment.personId).length
  const tentative = assignments.filter(
    (assignment) => !!assignment.personId && assignment.tentative,
  ).length
  return {
    total: assignments.length,
    assigned,
    unassigned: assignments.length - assigned,
    tentative,
  }
})
const assignmentRows = computed(() =>
  (service.value?.assignments ?? []).map((assignment) => ({
    ...assignment,
    person: assignment.personId
      ? peopleStore.people.find((person) => person.id === assignment.personId)
      : undefined,
  })),
)
const assignmentGroups = computed(() => {
  const remaining = [...assignmentRows.value]
  const groups = (settingsStore.librarySettings?.roleGroups ?? []).flatMap((group) => {
    const rows = remaining.filter((assignment) => group.roles.includes(assignment.role))
    for (const row of rows) remaining.splice(remaining.indexOf(row), 1)
    return rows.length ? [{ name: group.name, rows }] : []
  })
  if (remaining.length) groups.push({ name: 'Other', rows: remaining })
  return groups
})
const scriptureEntries = computed(() =>
  (service.value?.items ?? [])
    .filter(
      (item) =>
        item.type === 'scripture' ||
        (item.type === 'placeholder' && item.suggestedTab === 'scripture'),
    )
    .map((item) =>
      item.type === 'scripture'
        ? {
            ...item,
            reference: `${item.reference} · ${item.displayMode === 'full' ? 'Full text' : 'Reference only'}`,
          }
        : item,
    ),
)
interface PlannedSongRow {
  itemId: string
  songId?: string
  title: string
  label?: string
  empty: boolean
}
const plannedSongs = ref<PlannedSongRow[]>([])
const firstEmptySongSlotId = computed(() => plannedSongs.value.find((entry) => entry.empty)?.itemId)
const filledSongSlotCount = computed(
  () => plannedSongs.value.filter((entry) => !entry.empty).length,
)
type SermonFlowRow = { key: string; type: 'passage' | 'outline'; label: string; detail: string }
const sermonItem = computed(() => (service.value ? findSermonItem(service.value) : undefined))
const sermonMainPassage = computed(() => {
  const item = sermonItem.value
  return item?.passages.find((passage) => passage.id === item.mainPassageId)
})
const sermonFlow = computed({
  get: (): SermonFlowRow[] => {
    const item = sermonItem.value
    if (!item) return []
    const main = sermonMainPassage.value
    const legacy = [
      ...item.passages
        .filter((passage) => passage.id !== main?.id)
        .map((passage) => ({ type: 'passage' as const, passageId: passage.id })),
      ...item.outline.map((block) => ({ type: 'outline' as const, outlineId: block.id })),
    ]
    const rows: SermonFlowRow[] = []
    for (const entry of item.flow ?? legacy) {
      if (entry.type === 'passage') {
        const passage = item.passages.find((candidate) => candidate.id === entry.passageId)
        if (passage && passage.id !== main?.id)
          rows.push({
            key: `passage:${passage.id}`,
            type: 'passage',
            label: passage.reference || 'Untitled scripture',
            detail: passage.displayMode === 'full' ? 'Full text' : 'Reference only',
          })
      } else {
        const block = item.outline.find((candidate) => candidate.id === entry.outlineId)
        if (block)
          rows.push({
            key: `outline:${block.id}`,
            type: 'outline',
            label: block.label || 'Untitled point',
            detail: block.text || 'Outline point',
          })
      }
    }
    return rows
  },
  set: (rows: SermonFlowRow[]) => {
    const item = sermonItem.value
    if (!item) return
    item.flow = rows.map((row) =>
      row.type === 'passage'
        ? { type: 'passage', passageId: row.key.slice('passage:'.length) }
        : { type: 'outline', outlineId: row.key.slice('outline:'.length) },
    )
  },
})
function syncPlannedSongs() {
  plannedSongs.value = (service.value?.items ?? [])
    .filter(isPlanningSongSlot)
    .map((item): PlannedSongRow =>
      item.type === 'song'
        ? {
            itemId: item.id,
            songId: item.songId,
            title:
              songsStore.songs.find((song) => song.id === item.songId)?.title ?? 'Unavailable song',
            label: item.bulletinLabel,
            empty: false,
          }
        : {
            itemId: item.id,
            title: 'Not selected',
            label: item.bulletinLabel || item.label || 'Song',
            empty: true,
          },
    )
}
watch([service, () => songsStore.songs], syncPlannedSongs, { immediate: true })

watch(
  service,
  (next) => {
    const sermon = next && findSermonItem(next)
    sermonTitle.value = sermon?.title ?? ''
    passage.value = sermon ? sermonMainReference(sermon) : ''
    preacherId.value = next ? sermonPreacherId(next, sermon) : undefined
    serviceDate.value = next?.date ?? ''
    serviceTime.value = next?.time ?? ''
    serviceType.value = next?.type ?? ''
  },
  { immediate: true },
)

watch([serviceDate, serviceTime, serviceType], () => {
  if (!service.value) return
  service.value.date = serviceDate.value
  service.value.time = serviceTime.value || undefined
  service.value.type = serviceType.value
})

watch([sermonTitle, passage, preacherId], () => {
  const current = service.value
  if (!current) return
  if (!sermonTitle.value && !passage.value && !preacherId.value && !findSermonItem(current)) return
  applySermonEdit(
    current,
    { title: sermonTitle.value, passageReference: passage.value, preacherId: preacherId.value },
    defaultSermonRole(settingsStore.librarySettings?.serviceTemplates, current.type),
    settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
  )
})

function openScripturePicker(itemId: string) {
  const item = service.value?.items.find((candidate) => candidate.id === itemId)
  scriptureSlotId.value = itemId
  scriptureDraft.value =
    item?.type === 'scripture'
      ? { reference: item.reference, translation: item.translation, displayMode: item.displayMode }
      : {
          reference: '',
          translation: settingsStore.librarySettings?.defaultTranslationCode ?? '',
          displayMode: 'full',
        }
  scriptureDialog.value = true
}

function fillScriptureSlot() {
  const current = service.value
  const slotId = scriptureSlotId.value
  if (!current || !slotId || !scripturePickerRef.value?.isValid) return
  const index = current.items.findIndex((item) => item.id === slotId)
  if (index === -1) return
  const slot = current.items[index]
  current.items.splice(index, 1, {
    id: slot.id,
    type: 'scripture',
    reference: scriptureDraft.value.reference,
    translation: scriptureDraft.value.translation,
    displayMode: scriptureDraft.value.displayMode,
    role: slot.role,
    bulletinLabel: slot.type === 'placeholder' ? slot.label : slot.bulletinLabel,
    bulletinNote: slot.bulletinNote,
  })
  scriptureDialog.value = false
}

function openSermonPassageEditor(passageId?: string) {
  const existing = sermonItem.value?.passages.find((candidate) => candidate.id === passageId)
  sermonPassageId.value = passageId
  scriptureDraft.value = existing
    ? {
        reference: existing.reference,
        translation: existing.translation,
        displayMode: existing.displayMode,
      }
    : {
        reference: '',
        translation: settingsStore.librarySettings?.defaultTranslationCode ?? '',
        displayMode: 'full',
      }
  sermonPassageDialog.value = true
}

function saveSermonPassage() {
  const item = sermonItem.value
  if (!item || !scripturePickerRef.value?.isValid) return
  const existing = item.passages.find((candidate) => candidate.id === sermonPassageId.value)
  if (existing) Object.assign(existing, scriptureDraft.value)
  else {
    const id = `passage-${crypto.randomUUID()}`
    item.passages.push({ id, ...scriptureDraft.value })
    item.flow = item.flow ?? [
      ...item.passages
        .slice(0, -1)
        .filter((candidate) => candidate.id !== item.mainPassageId)
        .map((candidate) => ({ type: 'passage' as const, passageId: candidate.id })),
      ...item.outline.map((block) => ({ type: 'outline' as const, outlineId: block.id })),
    ]
    item.flow.push({ type: 'passage', passageId: id })
  }
  sermonPassageDialog.value = false
}

function openSermonOutlineEditor(outlineId?: string) {
  const existing = sermonItem.value?.outline.find((candidate) => candidate.id === outlineId)
  sermonOutlineId.value = outlineId
  sermonOutlineLabel.value = existing?.label ?? ''
  sermonOutlineText.value = existing?.text ?? ''
  sermonOutlineDialog.value = true
}

function saveSermonOutline() {
  const item = sermonItem.value
  if (!item) return
  const existing = item.outline.find((candidate) => candidate.id === sermonOutlineId.value)
  if (existing)
    Object.assign(existing, {
      label: sermonOutlineLabel.value.trim(),
      text: sermonOutlineText.value.trim(),
    })
  else {
    const id = `outline-${crypto.randomUUID()}`
    item.outline.push({
      id,
      label: sermonOutlineLabel.value.trim(),
      text: sermonOutlineText.value.trim(),
    })
    item.flow = item.flow ?? [
      ...item.passages
        .filter((candidate) => candidate.id !== item.mainPassageId)
        .map((candidate) => ({ type: 'passage' as const, passageId: candidate.id })),
      ...item.outline
        .slice(0, -1)
        .map((block) => ({ type: 'outline' as const, outlineId: block.id })),
    ]
    item.flow.push({ type: 'outline', outlineId: id })
  }
  sermonOutlineDialog.value = false
}

onMounted(async () => {
  try {
    await Promise.all([
      servicesStore.loaded ? Promise.resolve() : servicesStore.load(),
      peopleStore.loaded ? Promise.resolve() : peopleStore.load(),
      settingsStore.loaded ? Promise.resolve() : settingsStore.load(),
      songsStore.loaded ? Promise.resolve() : songsStore.load(),
    ])
    try {
      service.value = await getAdapter().services.get(route.params.id as string)
    } catch {
      service.value = undefined
    }
    await nextTick()
    documentHistory.start((dirty) => (isDirty.value = dirty))
    saveHandler.value = savePlan
    scriptureTranslations.value = await getAdapter().scripture.listTranslations()
  } finally {
    loadingPlan.value = false
  }
})

onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saving.value = false
  saveHandler.value = undefined
})

async function savePlan() {
  const current = service.value
  if (!current || saving.value) return
  saving.value = true
  try {
    current.date = serviceDate.value
    current.time = serviceTime.value || undefined
    current.type = serviceType.value
    if (sermonTitle.value || passage.value || preacherId.value || findSermonItem(current)) {
      applySermonEdit(
        current,
        { title: sermonTitle.value, passageReference: passage.value, preacherId: preacherId.value },
        defaultSermonRole(settingsStore.librarySettings?.serviceTemplates, current.type),
        settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
      )
    }
    current.planningNotes = current.planningNotes?.trim() || undefined
    await servicesStore.save(current)
    isDirty.value = false
  } finally {
    saving.value = false
  }
}

async function chooseSongs() {
  const current = service.value
  if (!current) return
  await savePlan()
  router.push({
    path: '/library/songs',
    query: { selectFor: current.id, returnTo: `/service/${current.id}/plan` },
  })
}

function removeSong(itemId: string) {
  const current = service.value
  if (!current) return
  current.items = compactPlanningSongSlots(
    current.items.map((item) =>
      item.id === itemId && item.type === 'song' ? emptyPlanningSongSlot(item) : item,
    ),
  )
  syncPlannedSongs()
}

function saveSongOrder() {
  const current = service.value
  if (!current) return
  const sourceItems = new Map(
    current.items.filter(isPlanningSongSlot).map((item) => [item.id, item]),
  )
  const orderedContent = plannedSongs.value
    .map((row) => sourceItems.get(row.itemId))
    .filter((item) => !!item)
  let slotIndex = 0
  current.items = current.items.map((item) => {
    if (!isPlanningSongSlot(item)) return item
    const content = orderedContent[slotIndex++]
    if (!content || content.type === 'placeholder') return emptyPlanningSongSlot(item)
    return placePlanningSongInSlot(item, content)
  })
  syncPlannedSongs()
}

async function applyTemplate() {
  const current = service.value
  const template = settingsStore.librarySettings?.serviceTemplates.find(
    (item) => item.serviceType === templateToApply.value,
  )
  if (!current || !template || applyingTemplate.value) return
  applyingTemplate.value = true
  try {
    current.date = serviceDate.value
    current.time = serviceTime.value || undefined
    current.type = serviceType.value
    const seeded = applyServiceTemplate(template)
    const plannedSongs = current.items.filter((item) => item.type === 'song')
    const plannedSermon = findSermonItem(current)
    const existingPreacherId = sermonPreacherId(current, plannedSermon)
    const reusableItems = current.items.filter(
      (item) => item.type !== 'song' && item.type !== 'sermon',
    )
    const usedItemIds = new Set<string>()
    const takeMatchingItem = (slot: (typeof seeded.items)[number]) => {
      const matchesKind = (item: (typeof current.items)[number]) => {
        if (slot.type === 'bulletin-note') return item.type === 'bulletin-note'
        if (slot.type !== 'placeholder') return false
        if (slot.suggestedTab === 'scripture') return item.type === 'scripture'
        if (slot.suggestedTab === 'slides')
          return item.type === 'slide-ref' || item.type === 'text-slide'
        if (slot.suggestedTab === 'media')
          return item.type === 'media' || item.type === 'video' || item.type === 'audio'
        return false
      }
      const match = reusableItems.find(
        (item) =>
          !usedItemIds.has(item.id) &&
          matchesKind(item) &&
          (!slot.role || item.role === slot.role) &&
          (!slot.bulletinLabel || !item.bulletinLabel || item.bulletinLabel === slot.bulletinLabel),
      )
      if (match) usedItemIds.add(match.id)
      return match
    }
    let songIndex = 0
    let sermonPlaced = false
    let sermonRole: string | undefined

    current.items = seeded.items.map((templateItem) => {
      if (templateItem.type === 'bulletin-note') {
        const existing = takeMatchingItem(templateItem)
        return existing?.type === 'bulletin-note'
          ? {
              ...existing,
              id: templateItem.id,
              role: templateItem.role ?? existing.role,
              bulletinLabel: templateItem.bulletinLabel ?? existing.bulletinLabel,
              bulletinNote: templateItem.bulletinNote ?? existing.bulletinNote,
            }
          : templateItem
      }
      if (templateItem.type !== 'placeholder') return templateItem
      if (templateItem.suggestedTab === 'songs') {
        const song = plannedSongs[songIndex++]
        if (!song) return templateItem
        return placePlanningSongInSlot(templateItem, song)
      }
      if (templateItem.suggestedTab === 'sermon' && plannedSermon) {
        sermonPlaced = true
        sermonRole = templateItem.role ?? plannedSermon.role
        return {
          ...plannedSermon,
          id: templateItem.id,
          role: sermonRole,
          bulletinLabel: templateItem.label ?? plannedSermon.bulletinLabel,
          bulletinNote: templateItem.bulletinNote ?? plannedSermon.bulletinNote,
        }
      }
      const existing = takeMatchingItem(templateItem)
      return existing
        ? {
            ...existing,
            id: templateItem.id,
            role: templateItem.role ?? existing.role,
            bulletinLabel: templateItem.label ?? existing.bulletinLabel,
            bulletinNote: templateItem.bulletinNote ?? existing.bulletinNote,
          }
        : templateItem
    })
    if (plannedSermon && !sermonPlaced) current.items.push(plannedSermon)

    const existingAssignments = current.assignments ?? []
    const usedAssignments = new Set<number>()
    current.assignments = seeded.assignments.map((assignment) => {
      const index = existingAssignments.findIndex(
        (existing, i) => !usedAssignments.has(i) && existing.role === assignment.role,
      )
      if (index === -1) return assignment
      usedAssignments.add(index)
      return {
        ...assignment,
        personId: existingAssignments[index].personId,
        tentative: existingAssignments[index].tentative,
      }
    })
    if (sermonRole && existingPreacherId) {
      const preacherAssignment = current.assignments.find(
        (assignment) => assignment.role === sermonRole,
      )
      if (preacherAssignment) preacherAssignment.personId = existingPreacherId
    }
    current.serviceTemplateName = template.serviceType
    syncPlannedSongs()
    await servicesStore.save(current)
    isDirty.value = false
    historyStore.markSaved()
    templateToApply.value = undefined
    templateDialog.value = false
  } finally {
    applyingTemplate.value = false
  }
}
</script>

<template>
  <main class="service-plan-page">
    <template v-if="loadingPlan">
      <section class="plan-missing">
        <v-progress-circular indeterminate color="primary" />
        <p>Loading service plan…</p>
      </section>
    </template>
    <template v-else-if="service">
      <header class="plan-editor-header">
        <div class="plan-header">
          <v-btn :to="backTo" variant="text" prepend-icon="mdi-arrow-left">{{ backLabel }}</v-btn>
          <div class="plan-heading">
            <div>
              <span>Service Plan</span>
              <h1>{{ serviceType }}</h1>
              <p>
                {{
                  new Date(`${serviceDate}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                }}
                · {{ formatServiceTime(serviceTime) ?? 'Time Not Set' }}
              </p>
            </div>
            <div class="plan-heading-actions">
              <v-btn
                variant="tonal"
                prepend-icon="mdi-file-tree-outline"
                @click="templateDialog = true"
                >{{
                  service.serviceTemplateName ? service.serviceTemplateName : 'Apply Template'
                }}</v-btn
              ><v-btn
                variant="tonal"
                prepend-icon="mdi-file-document-outline"
                :to="routeWithReturnTo(`/service/${service.id}/bulletin`, route.fullPath)"
                >Bulletin</v-btn
              ><v-btn
                variant="tonal"
                prepend-icon="mdi-arrow-top-right"
                @click="router.push(routeWithReturnTo(`/service/${service.id}`, route.fullPath))"
                >Open Full Service</v-btn
              >
            </div>
          </div>
        </div>
      </header>
      <section class="plan-card">
        <section class="plan-main">
          <h2>Service Details</h2>
          <v-row class="service-details-row service-details-row--metadata"
            ><v-col cols="12" md="4"
              ><v-text-field
                v-model="serviceDate"
                type="date"
                label="Service Date"
                variant="outlined" /></v-col
            ><v-col cols="12" md="4"
              ><five-minute-time-picker v-model="serviceTime" label="Start Time" /></v-col
            ><v-col cols="12" md="4"
              ><v-select
                v-model="serviceType"
                :items="settingsStore.librarySettings?.serviceTypes ?? []"
                label="Service Type"
                variant="outlined" /></v-col
          ></v-row>
          <v-textarea
            v-model="service.planningNotes"
            label="Planning Notes"
            placeholder="Ideas, reminders, themes, or details to work out later"
            variant="outlined"
            rows="3"
            auto-grow
            hide-details
          />
        </section>
        <section class="plan-sermon-flow plan-sermon-details">
          <div class="plan-team-heading">
            <div>
              <h2>Sermon</h2>
              <p>Plan the message and its presentation flow.</p>
            </div>
          </div>
          <v-row class="sermon-details-row"
            ><v-col cols="12"
              ><v-text-field
                v-model="sermonTitle"
                label="Sermon Title"
                variant="outlined"
                hide-details /></v-col
          ></v-row>
          <v-row class="sermon-details-row"
            ><v-col cols="12" lg="6"
              ><v-select
                v-model="preacherId"
                :items="preacherOptions"
                label="Preacher"
                variant="outlined"
                clearable
                hide-details /></v-col
            ><v-col cols="12" lg="6"
              ><v-text-field
                v-model="passage"
                label="Main Passage"
                placeholder="e.g. Matthew 6:9-13"
                variant="outlined"
                hide-details /></v-col
          ></v-row>
        </section>
        <section v-if="sermonItem" class="plan-sermon-flow">
          <div class="plan-team-heading">
            <div>
              <h2>Sermon Flow</h2>
            </div>
            <div class="sermon-flow-actions">
              <v-btn
                size="small"
                variant="tonal"
                color="primary"
                prepend-icon="mdi-book-plus-outline"
                @click="openSermonPassageEditor()"
                >Add Scripture</v-btn
              ><v-btn
                size="small"
                variant="tonal"
                color="primary"
                prepend-icon="mdi-format-list-bulleted"
                @click="openSermonOutlineEditor()"
                >Add Point</v-btn
              >
            </div>
          </div>
          <div
            v-if="sermonMainPassage && sermonItem.presentMainPassage !== false"
            class="sermon-flow-row sermon-flow-row--main"
          >
            <v-icon icon="mdi-pin-outline" size="18" /><span
              ><strong>{{ sermonMainPassage.reference || 'Main passage' }}</strong
              ><small
                >Main passage ·
                {{
                  sermonMainPassage.displayMode === 'full' ? 'Full text' : 'Reference only'
                }}</small
              ></span
            >
          </div>
          <VueDraggable
            v-if="sermonFlow.length"
            v-model="sermonFlow"
            class="sermon-flow-list"
            handle=".sermon-flow-drag"
            :animation="150"
            ><div
              v-for="entry in sermonFlow"
              :key="entry.key"
              class="sermon-flow-row"
              :class="`sermon-flow-row--${entry.type}`"
            >
              <v-icon icon="mdi-drag-vertical" size="18" class="sermon-flow-drag" /><v-icon
                :icon="
                  entry.type === 'passage'
                    ? 'mdi-book-open-page-variant-outline'
                    : 'mdi-format-list-bulleted'
                "
                size="18"
              /><span
                ><strong>{{ entry.label }}</strong
                ><small>{{
                  entry.type === 'passage' ? entry.detail : 'Outline point'
                }}</small></span
              ><v-btn
                icon="mdi-pencil-outline"
                variant="text"
                size="x-small"
                :aria-label="`Edit ${entry.label}`"
                @click="
                  entry.type === 'passage'
                    ? openSermonPassageEditor(entry.key.slice('passage:'.length))
                    : openSermonOutlineEditor(entry.key.slice('outline:'.length))
                "
              /></div
          ></VueDraggable>
          <p v-else class="empty-songs">
            Add supporting scripture or outline points to build the sermon flow.
          </p>
        </section>
        <div class="plan-grid">
          <section v-if="scriptureEntries.length" class="plan-scriptures">
            <div class="plan-team-heading">
              <div>
                <h2>Scripture</h2>
                <p>Fill the scripture places defined in the service order.</p>
              </div>
            </div>
            <div class="scripture-list">
              <div v-for="entry in scriptureEntries" :key="entry.id" class="scripture-row">
                <v-icon icon="mdi-book-open-page-variant-outline" size="19" /><span
                  ><strong>{{
                    entry.type === 'placeholder'
                      ? entry.label || 'Scripture'
                      : entry.bulletinLabel || 'Scripture'
                  }}</strong
                  ><small>{{
                    entry.type === 'scripture' ? entry.reference : 'Not selected'
                  }}</small></span
                ><v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  @click="openScripturePicker(entry.id)"
                  >{{ entry.type === 'scripture' ? 'Change' : 'Choose Scripture' }}</v-btn
                >
              </div>
            </div>
          </section>
          <aside class="plan-songs">
            <div>
              <div class="plan-songs-heading">
                <h2>Service Songs</h2>
                <span v-if="plannedSongs.length" class="song-slot-status"
                  >{{ filledSongSlotCount }} of {{ plannedSongs.length }} filled</span
                >
              </div>
              <p>These are part of the service order. Drag to set their planning order.</p>
            </div>
            <VueDraggable
              v-if="plannedSongs.length"
              v-model="plannedSongs"
              class="plan-song-list"
              handle=".plan-song-drag"
              :animation="150"
              @end="saveSongOrder"
              ><div
                v-for="entry in plannedSongs"
                :key="entry.itemId"
                class="plan-song-row"
                :class="{ 'plan-song-row--empty': entry.empty }"
              >
                <v-icon icon="mdi-drag-vertical" size="19" class="plan-song-drag" /><span
                  ><small v-if="entry.label">{{ entry.label }}</small
                  ><strong>{{ entry.title }}</strong></span
                ><v-btn
                  v-if="!entry.empty"
                  icon="mdi-close"
                  variant="text"
                  size="x-small"
                  aria-label="Remove song from this slot"
                  @click="removeSong(entry.itemId)"
                /><v-btn
                  v-else-if="entry.itemId === firstEmptySongSlotId"
                  color="primary"
                  variant="tonal"
                  size="x-small"
                  @click="chooseSongs"
                  >Choose Song</v-btn
                >
              </div></VueDraggable
            >
            <p v-else class="empty-songs">No song slots yet.</p>
            <v-btn
              color="primary"
              variant="tonal"
              prepend-icon="mdi-music-note-plus"
              @click="chooseSongs"
              >Choose Songs from Library</v-btn
            >
          </aside>
        </div>
        <section class="plan-team plan-team--full">
          <div class="plan-team-heading">
            <div>
              <h2>Assignments</h2>
              <p v-if="assignmentSummary.total">
                <strong>{{ assignmentSummary.assigned }} of {{ assignmentSummary.total }}</strong>
                roles assigned<span v-if="assignmentSummary.unassigned">
                  · {{ assignmentSummary.unassigned }} need{{
                    assignmentSummary.unassigned === 1 ? 's' : ''
                  }}
                  people</span
                ><span v-if="assignmentSummary.tentative">
                  · {{ assignmentSummary.tentative }} tentative</span
                >
              </p>
              <p v-else>Apply a template to add service roles.</p>
            </div>
            <v-btn
              :to="routeWithReturnTo(`/service/${service.id}/assignments`, route.fullPath)"
              variant="outlined"
              color="primary"
              prepend-icon="mdi-account-group-outline"
              >Manage Assignments</v-btn
            >
          </div>
          <div v-if="assignmentGroups.length" class="assignment-groups">
            <section v-for="group in assignmentGroups" :key="group.name" class="assignment-group">
              <h3>{{ group.name }}</h3>
              <div class="assignment-list">
                <div
                  v-for="(assignment, index) in group.rows"
                  :key="`${assignment.role}-${assignment.personId ?? 'missing'}-${index}`"
                  class="assignment-row"
                  :class="{
                    'assignment-row--missing': !assignment.person,
                    'assignment-row--tentative': assignment.person && assignment.tentative,
                  }"
                >
                  <v-icon
                    :icon="
                      assignment.person ? 'mdi-account-check-outline' : 'mdi-account-alert-outline'
                    "
                    size="18"
                  /><span
                    ><strong>{{ assignment.role }}</strong
                    ><small v-if="assignment.person"
                      >{{ personFormalName(assignment.person)
                      }}<template v-if="assignment.tentative"> · Tentative</template></small
                    ><small v-else>Needs a person</small></span
                  >
                </div>
              </div>
            </section>
          </div>
        </section>
        <v-dialog v-model="templateDialog" max-width="620"
          ><v-card
            ><v-card-title>Service Template</v-card-title
            ><v-card-text
              ><template v-if="service.serviceTemplateName"
                ><div class="current-template">
                  <v-icon icon="mdi-file-tree-outline" size="22" />
                  <div>
                    <span>Current template</span><strong>{{ service.serviceTemplateName }}</strong>
                  </div>
                </div>
                <p class="template-dialog-copy">
                  Applying a different template replaces the service structure while retaining
                  matching assignments and planned content where it belongs.
                </p></template
              >
              <p v-else class="template-dialog-copy">
                Choose a template to add its service order and assignments to this plan.
              </p>
              <v-select
                v-model="templateToApply"
                :items="templateOptions"
                :label="service.serviceTemplateName ? 'Change template' : 'Choose template'"
                variant="outlined"
                hide-details
                clearable /></v-card-text
            ><v-card-actions
              ><v-spacer /><v-btn variant="text" @click="templateDialog = false">Cancel</v-btn
              ><v-btn
                color="primary"
                variant="flat"
                :disabled="!templateToApply"
                :loading="applyingTemplate"
                @click="applyTemplate"
                >{{ service.serviceTemplateName ? 'Apply New Template' : 'Apply Template' }}</v-btn
              ></v-card-actions
            ></v-card
          ></v-dialog
        >
        <v-dialog v-model="sermonPassageDialog" max-width="720"
          ><v-card
            ><v-card-title>{{
              sermonPassageId ? 'Edit Supporting Scripture' : 'Add Supporting Scripture'
            }}</v-card-title
            ><v-card-text
              ><ScriptureReferencePicker
                ref="scripturePickerRef"
                v-model="scriptureDraft"
                :translations="scriptureTranslations" /></v-card-text
            ><v-card-actions
              ><v-spacer /><v-btn variant="text" @click="sermonPassageDialog = false">Cancel</v-btn
              ><v-btn
                color="primary"
                variant="flat"
                :disabled="!scripturePickerRef?.isValid"
                @click="saveSermonPassage"
                >Save Scripture</v-btn
              ></v-card-actions
            ></v-card
          ></v-dialog
        >
        <v-dialog v-model="sermonOutlineDialog" max-width="620"
          ><v-card
            ><v-card-title>{{
              sermonOutlineId ? 'Edit Outline Point' : 'Add Outline Point'
            }}</v-card-title
            ><v-card-text
              ><v-text-field
                v-model="sermonOutlineLabel"
                label="Point title"
                placeholder="e.g. God calls us to trust Him"
                variant="outlined" /><v-textarea
                v-model="sermonOutlineText"
                label="Point detail"
                placeholder="Optional supporting text for the presentation slide"
                variant="outlined"
                rows="4"
                auto-grow
                hide-details /></v-card-text
            ><v-card-actions
              ><v-spacer /><v-btn variant="text" @click="sermonOutlineDialog = false">Cancel</v-btn
              ><v-btn color="primary" variant="flat" @click="saveSermonOutline"
                >Save Point</v-btn
              ></v-card-actions
            ></v-card
          ></v-dialog
        >
        <v-dialog v-model="scriptureDialog" max-width="720"
          ><v-card
            ><v-card-title>Choose Scripture</v-card-title
            ><v-card-text
              ><ScriptureReferencePicker
                ref="scripturePickerRef"
                v-model="scriptureDraft"
                :translations="scriptureTranslations" /></v-card-text
            ><v-card-actions
              ><v-spacer /><v-btn variant="text" @click="scriptureDialog = false">Cancel</v-btn
              ><v-btn
                color="primary"
                variant="flat"
                :disabled="!scripturePickerRef?.isValid"
                @click="fillScriptureSlot"
                >Use Scripture</v-btn
              ></v-card-actions
            ></v-card
          ></v-dialog
        >
      </section>
    </template>
    <section v-else class="plan-missing">
      <h1>Service plan not found</h1>
      <v-btn to="/" color="primary" variant="flat">Back to Services</v-btn>
    </section>
  </main>
</template>

<style scoped>
/* Consolidated from an earlier redesign that left the previous "boxed cards in a fixed grid"
   version's rules in place alongside the current "borderless flowing grid" ones, each selector
   redefined several times over — every rule below is the single, final, actually-applying result
   of that whole cascade, not a fresh design. One real bug surfaced doing this: .plan-grid used to
   get `align-items: start` from a later *unconditional* rule that — by plain CSS source-order,
   media queries don't get special priority — won the cascade even under the (max-width: 760px)
   block below that intended `align-items: stretch`, so .plan-scriptures/.plan-songs never
   actually stretched to the stacked column's full width. Fixed at the source here instead of
   patched with an explicit width override. */
.service-plan-page {
  min-height: 100%;
  padding: 0 0 56px;
  background:
    radial-gradient(circle at 76% 0, rgba(var(--v-theme-teal), 0.045), transparent 420px),
    rgb(var(--v-theme-background));
}
.plan-editor-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-surface), 0.76);
}
.plan-header,
.plan-card,
.plan-missing {
  width: min(100%, 1440px);
  max-width: none;
  margin: 0 auto;
}
.plan-header {
  padding: 18px 32px 22px;
}
.plan-header > .v-btn {
  margin: 0 0 8px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  text-transform: none;
}
.plan-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin: 0;
}
.plan-heading span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.plan-heading h1 {
  margin: 4px 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: clamp(1.65rem, 2.5vw, 2.2rem);
  max-width: 760px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-heading-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.plan-heading p,
.plan-songs p,
.empty-songs {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.74rem;
}
.plan-card {
  width: min(100%, 1440px);
  max-width: none;
  margin: 0 auto;
  padding: 28px 32px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  column-gap: 24px;
  align-items: start;
}
.plan-grid {
  display: contents;
}
.plan-main,
.plan-team--full {
  grid-column: 1 / -1;
}
.plan-sermon-details,
.plan-sermon-details + .plan-sermon-flow,
.plan-scriptures {
  grid-column: 1;
}
.plan-main {
  padding: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
h2 {
  margin: 0 0 16px;
  font-size: 1rem;
}
.service-details-row--metadata {
  margin-bottom: -12px;
}
.plan-sermon-flow {
  margin-top: 18px;
  padding: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.plan-sermon-details {
  margin-bottom: 0;
  border-bottom: 0;
  border-radius: 11px 11px 0 0;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.plan-sermon-details + .plan-sermon-flow {
  margin-top: 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 0 0 11px 11px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.sermon-flow-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.sermon-flow-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.sermon-flow-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
}
.sermon-flow-row > .v-icon {
  color: rgb(var(--v-theme-primary));
}
.sermon-flow-row > span {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.sermon-flow-row strong {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sermon-flow-row small {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.66rem;
}
.sermon-flow-row--main {
  margin: 12px 0 7px;
  border-color: rgba(var(--v-theme-primary), 0.24);
  background: rgba(var(--v-theme-primary), 0.07);
}
.sermon-flow-row--passage {
  border-left: 3px solid rgb(var(--v-theme-teal));
  background: rgba(var(--v-theme-teal), 0.06);
}
.sermon-flow-row--passage > .v-icon {
  color: rgb(var(--v-theme-teal));
}
.sermon-flow-row--outline {
  border-left: 3px solid rgb(var(--v-theme-violet));
  background: rgba(var(--v-theme-violet), 0.06);
}
.sermon-flow-row--outline > .v-icon {
  color: rgb(var(--v-theme-violet));
}
.sermon-flow-drag {
  cursor: grab;
}
.sermon-flow-drag:active {
  cursor: grabbing;
}
.template-apply {
  display: block;
  margin: 0 0 20px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.045);
}
.template-apply-copy h3 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.78rem;
}
.template-apply-copy h3 span {
  margin-left: 5px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.62rem;
  font-weight: 500;
}
.template-apply-copy p {
  margin: 4px 0 11px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.7rem;
}
.template-apply-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}
.current-template {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 11px 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
}
.current-template > .v-icon {
  color: rgb(var(--v-theme-primary));
}
.current-template div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.current-template span {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.64rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.current-template strong {
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1rem;
  line-height: 1.25;
}
.template-dialog-copy {
  margin: 14px 0 18px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.82rem;
  line-height: 1.5;
}
.plan-song-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0;
}
.plan-song-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
  font-size: 0.76rem;
}
.plan-song-row .v-icon {
  color: rgb(var(--v-theme-primary));
}
.plan-song-drag {
  cursor: grab;
}
.plan-song-drag:active {
  cursor: grabbing;
}
.plan-song-row > span {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.plan-song-row > span small {
  color: rgb(var(--v-theme-primary));
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.plan-song-row > span strong {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-song-row--empty {
  border-style: dashed;
  background: rgba(var(--v-theme-primary), 0.035);
}
.plan-song-row--empty > span strong {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-style: italic;
}
.empty-songs {
  margin: 18px 0;
}
.plan-songs > .plan-team {
  display: none;
}
.plan-songs-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.plan-songs h2 {
  margin-bottom: 4px;
}
.song-slot-status {
  flex: none;
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 700;
}
.plan-songs {
  padding: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
  position: static;
  grid-column: 2;
  grid-row: 2 / span 3;
  margin-top: 18px;
}
.plan-scriptures {
  padding: 24px;
  margin: 18px 0 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.scripture-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.scripture-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
}
.scripture-row > .v-icon {
  color: rgb(var(--v-theme-primary));
}
.scripture-row > span {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.scripture-row strong {
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-size: 0.74rem;
}
.scripture-row small {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.66rem;
}
.plan-team--full {
  padding: 24px;
  margin: 18px 0 0;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}
.plan-team--full + .plan-actions {
  margin-top: 0;
}
.plan-team {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.plan-team-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}
.plan-team h2 {
  margin-bottom: 5px;
}
.plan-team p {
  margin-bottom: 12px;
}
.plan-team strong {
  color: rgb(var(--v-theme-primary));
}
.assignment-groups {
  display: block;
  column-count: 2;
  column-gap: 16px;
}
.assignment-group {
  break-inside: avoid;
  margin: 0 0 16px;
}
.assignment-group h3 {
  margin: 0 0 7px;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.assignment-list {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
  overflow: hidden;
}
.assignment-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.assignment-row:last-child {
  border-bottom: 0;
}
.assignment-row > .v-icon {
  color: rgb(var(--v-theme-primary));
}
.assignment-row--missing {
  background: rgba(var(--v-theme-warning), 0.1);
}
.assignment-row--missing > .v-icon,
.assignment-row--missing strong {
  color: rgb(var(--v-theme-warning));
}
.assignment-row--tentative {
  background: rgba(var(--v-theme-violet), 0.1);
}
.assignment-row--tentative > .v-icon,
.assignment-row--tentative strong {
  color: rgb(var(--v-theme-violet));
}
.assignment-row span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.assignment-row strong {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.7rem;
}
.assignment-row small {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.64rem;
}
.plan-actions {
  display: flex;
  padding: 14px 20px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.plan-missing {
  padding: 70px 0;
  text-align: center;
}
@media (max-width: 500px) {
  .template-apply-controls {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .plan-header,
  .plan-card {
    padding-right: 20px;
    padding-left: 20px;
  }
  .plan-card {
    display: block;
  }
  .plan-heading,
  .plan-grid {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .plan-grid {
    gap: 24px;
    margin-top: 18px;
  }
  .plan-songs {
    border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
    border-left: 0;
    margin-top: 0;
  }
  .assignment-groups {
    column-count: 1;
  }
}
</style>
