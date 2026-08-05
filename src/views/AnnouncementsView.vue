<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAnnouncementsStore } from '@/stores/announcements'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import type { Announcement } from '@/models/announcement'
import { effectiveStopDate, isEventDated, requiresExplicitStopDate } from '@/utils/announcementVisibility'

const announcementsStore = useAnnouncementsStore()
const confirmDialog = useConfirmDialogStore()

onMounted(() => announcementsStore.load())

const sorted = computed(() =>
  [...announcementsStore.announcements].sort((a, b) => {
    // Upcoming (event-dated) entries first, soonest first; standing announcements after, most
    // recently updated first — matches how each section reads on the printed bulletin itself.
    if (isEventDated(a) !== isEventDated(b)) return isEventDated(a) ? -1 : 1
    if (isEventDated(a)) return (a.eventDate ?? '').localeCompare(b.eventDate ?? '')
    return b.updatedAt.localeCompare(a.updatedAt)
  }),
)

function newDraft(): Announcement {
  return {
    id: crypto.randomUUID(),
    text: '',
    updatedAt: '',
    updatedByDevice: '',
  }
}

const dialogOpen = ref(false)
const isNew = ref(false)
const draft = reactive<Announcement>(newDraft())
// Radio choice driving which fields show — derived from the draft when editing an existing
// entry, chosen explicitly by the operator for a new one. Switching away from "event" clears the
// event-only fields so a half-filled event date can't linger and silently reclassify the entry.
const pattern = ref<'event' | 'ongoing'>('event')
const saveError = ref('')

function openAdd() {
  isNew.value = true
  Object.assign(draft, newDraft())
  pattern.value = 'event'
  saveError.value = ''
  dialogOpen.value = true
}

function openEdit(announcement: Announcement) {
  isNew.value = false
  Object.assign(draft, announcement)
  pattern.value = isEventDated(announcement) ? 'event' : 'ongoing'
  saveError.value = ''
  dialogOpen.value = true
}

function setPattern(next: 'event' | 'ongoing') {
  pattern.value = next
  if (next === 'ongoing') {
    draft.eventDate = undefined
    draft.eventEndDate = undefined
    draft.eventTime = undefined
  } else {
    draft.showFrom = undefined
  }
}

const validationMessage = computed(() => {
  if (!draft.text.trim()) return 'Enter the announcement text.'
  if (pattern.value === 'event' && !draft.eventDate) return 'Enter an event date.'
  if (requiresExplicitStopDate(draft)) {
    return 'An ongoing announcement needs a date to stop showing on.'
  }
  return ''
})

const saving = ref(false)
async function save() {
  saveError.value = validationMessage.value
  if (saveError.value) return
  saving.value = true
  try {
    await announcementsStore.save({ ...draft })
    dialogOpen.value = false
  } finally {
    saving.value = false
  }
}

async function remove(announcement: Announcement) {
  const label = announcement.text.length > 60 ? `${announcement.text.slice(0, 60)}…` : announcement.text
  if (!(await confirmDialog.confirm(`Delete "${label}"?`, 'Delete'))) return
  await announcementsStore.remove(announcement.id)
}

function dateRangeLabel(a: Announcement): string {
  if (!a.eventDate) return ''
  const parts = [formatDate(a.eventDate)]
  if (a.eventEndDate) parts.push(`– ${formatDate(a.eventEndDate)}`)
  if (a.eventTime) parts.push(a.eventTime)
  return parts.join(' ')
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function stopDateLabel(a: Announcement): string {
  const stop = effectiveStopDate(a)
  return stop ? `Stops showing after ${formatDate(stop)}` : ''
}
</script>

<template>
  <main class="announcements-page">
    <header class="announcements-hero">
      <div>
        <div class="page-eyebrow">Bulletin</div>
        <h1>Announcements</h1>
        <p>
          Upcoming events and ongoing notices for the printed bulletin — separate from Slide
          Library announcement slides, since print entries usually say more than an on-screen
          slide does.
        </p>
      </div>
      <v-btn variant="flat" color="primary" prepend-icon="mdi-bullhorn-outline" @click="openAdd">
        Add Announcement
      </v-btn>
    </header>

    <AsyncLoadState
      v-if="!announcementsStore.loaded"
      :loading="announcementsStore.loading"
      :error="announcementsStore.loadError"
      label="announcements"
      @retry="announcementsStore.load"
    />
    <template v-else>
      <v-alert
        v-if="announcementsStore.mutationError"
        type="error"
        variant="tonal"
        closable
        class="mb-4"
        @click:close="announcementsStore.clearMutationError"
      >
        Announcement changes were not saved: {{ announcementsStore.mutationError }}
      </v-alert>

      <LibraryEmptyState
        v-if="sorted.length === 0"
        icon="mdi-bullhorn-outline"
        title="No Announcements Yet"
        message="Add an upcoming event or an ongoing notice to include on the printed bulletin."
      >
        <v-btn variant="flat" color="primary" @click="openAdd">Add Announcement</v-btn>
      </LibraryEmptyState>

      <div v-else class="announcement-list">
        <article v-for="a in sorted" :key="a.id" class="announcement-card">
          <div class="announcement-body">
            <span class="announcement-kind" :class="{ 'announcement-kind--event': isEventDated(a) }">
              {{ isEventDated(a) ? 'Upcoming' : 'Standing' }}
            </span>
            <p class="announcement-text">{{ a.text }}</p>
            <p v-if="dateRangeLabel(a)" class="announcement-meta">{{ dateRangeLabel(a) }}</p>
            <p v-if="a.showFrom" class="announcement-meta">
              Starts showing {{ formatDate(a.showFrom) }}
            </p>
            <p v-if="stopDateLabel(a)" class="announcement-meta">{{ stopDateLabel(a) }}</p>
          </div>
          <div class="announcement-actions">
            <v-btn icon="mdi-pencil-outline" variant="text" size="small" aria-label="Edit" @click="openEdit(a)" />
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              size="small"
              color="error"
              aria-label="Delete"
              @click="remove(a)"
            />
          </div>
        </article>
      </div>
    </template>

    <v-dialog v-model="dialogOpen" max-width="560">
      <v-card>
        <v-card-title>{{ isNew ? 'Add Announcement' : 'Edit Announcement' }}</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="draft.text"
            label="Announcement text"
            variant="outlined"
            rows="3"
            auto-grow
            hide-details="auto"
            class="mb-4"
          />

          <v-radio-group
            :model-value="pattern"
            inline
            hide-details
            class="mb-2"
            @update:model-value="(v) => setPattern(v as 'event' | 'ongoing')"
          >
            <v-radio label="Upcoming event (has a date)" value="event" />
            <v-radio label="Ongoing / standing notice" value="ongoing" />
          </v-radio-group>

          <template v-if="pattern === 'event'">
            <div class="date-row">
              <v-text-field
                v-model="draft.eventDate"
                type="date"
                label="Event date"
                variant="outlined"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model="draft.eventEndDate"
                type="date"
                label="Through (optional)"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
            <v-text-field
              v-model="draft.eventTime"
              label="Time (optional, e.g. 4:30pm or 1–6pm)"
              variant="outlined"
              density="compact"
              hide-details
              class="mt-3"
            />
          </template>
          <template v-else>
            <div class="date-row">
              <v-text-field
                v-model="draft.showFrom"
                type="date"
                label="Start showing (optional)"
                variant="outlined"
                density="compact"
                hide-details
              />
              <v-text-field
                v-model="draft.showUntil"
                type="date"
                label="Stop showing"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
          </template>

          <v-alert v-if="saveError" type="error" variant="tonal" density="compact" class="mt-4">
            {{ saveError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialogOpen = false">Cancel</v-btn>
          <v-btn variant="flat" color="primary" :loading="saving" @click="save">
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.announcements-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 30px 34px 56px;
}
.announcements-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}
.page-eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.announcements-hero h1 {
  margin: 3px 0 0;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
}
.announcements-hero p {
  max-width: 560px;
  margin: 7px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.82rem;
  line-height: 1.5;
}
.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.announcement-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-surface), 0.7);
}
.announcement-body {
  min-width: 0;
  flex: 1;
}
.announcement-kind {
  display: inline-block;
  margin-bottom: 6px;
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.announcement-kind--event {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.announcement-text {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.92rem;
  line-height: 1.45;
  white-space: pre-wrap;
}
.announcement-meta {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.76rem;
}
.announcement-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}
.date-row {
  display: flex;
  gap: 12px;
}
.date-row > * {
  flex: 1;
}
</style>
