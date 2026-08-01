<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import LibraryEmptyState from '@/components/LibraryEmptyState.vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useMediaStore } from '@/stores/media'
import { usePeopleStore } from '@/stores/people'
import { useServicesStore } from '@/stores/services'
import { useSlidesStore } from '@/stores/slides'
import { useSongsStore } from '@/stores/songs'
import { useSyncStore } from '@/stores/sync'
import { useThemesStore } from '@/stores/themes'
import { diffFields } from '@/utils/conflictDiff'
import type { ConflictedItem, RecoveryIssue } from '@/adapters/types'

const router = useRouter()
const store = useSyncStore()
const confirmDialog = useConfirmDialogStore()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const mediaStore = useMediaStore()
const themesStore = useThemesStore()
const peopleStore = usePeopleStore()
const servicesStore = useServicesStore()

const activePath = ref('')
const activeOperation = ref('')
const actionError = ref('')
const actionNotice = ref('')
const initialIssueCount = ref(0)
const resolvedConflictCount = ref(0)
const initialConflictCount = ref(0)

const issueCount = computed(() => store.conflicts.length + store.recoveryIssues.length)
const finishedReview = computed(
  () => store.loaded && initialIssueCount.value > 0 && issueCount.value === 0,
)

onMounted(async () => {
  await store.load()
  initialIssueCount.value = issueCount.value
  initialConflictCount.value = store.conflicts.length
})

function formatWhen(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Time not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function deviceName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function formatFieldName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value, null, 2)
}

function changedFields(conflict: ConflictedItem) {
  return diffFields(conflict.thisVersion, conflict.otherVersion).filter((field) => field.changed)
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    song: 'Song',
    slide: 'Slides',
    media: 'Media',
    theme: 'Theme',
    person: 'Person',
    service: 'Service',
  }
  return labels[kind] ?? formatFieldName(kind)
}

function recoveryKind(relativePath: string): string | undefined {
  const directory = relativePath.replaceAll('\\', '/').split('/')[0]
  return {
    songs: 'song',
    slides: 'slide',
    'media-items': 'media',
    themes: 'theme',
    people: 'person',
    services: 'service',
  }[directory]
}

async function refreshLibraryKind(kind: string | undefined): Promise<boolean> {
  if (kind === 'song') return songsStore.load()
  if (kind === 'slide') return slidesStore.load()
  if (kind === 'media') return mediaStore.load()
  if (kind === 'theme') return themesStore.load()
  if (kind === 'person') return peopleStore.load()
  if (kind === 'service') return servicesStore.load()
  return true
}

async function resolveConflict(conflict: ConflictedItem, keep: 'mine' | 'theirs') {
  const keepingMine = keep === 'mine'
  const chosenName = keepingMine
    ? deviceName(conflict.thisVersion.updatedByDevice, 'this computer')
    : conflict.otherDevice
  const discardedName = keepingMine
    ? conflict.otherDevice
    : deviceName(conflict.thisVersion.updatedByDevice, 'this computer')
  const detail = keepingMine
    ? `Keep the version from ${chosenName} and permanently discard the conflicted copy from ${discardedName}?`
    : `Replace the current version with the one from ${chosenName}? The current version from ${discardedName} will remain available as its automatic backup.`
  if (!(await confirmDialog.confirm(detail, `Keep ${chosenName} Version`))) return

  activePath.value = conflict.conflictFilePath
  activeOperation.value = `${conflict.conflictFilePath}:${keep}`
  actionError.value = ''
  actionNotice.value = ''
  try {
    await store.resolve(conflict.conflictFilePath, keep)
    const refreshed = await refreshLibraryKind(conflict.kind)
    resolvedConflictCount.value += 1
    if (refreshed)
      actionNotice.value = `${conflict.label} now uses the version from ${chosenName}.`
    else
      actionError.value = `${conflict.label} was resolved, but the in-memory library could not be refreshed. Retry the affected library page or restart Worship Studio.`
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    activePath.value = ''
    activeOperation.value = ''
  }
}

async function restore(issue: RecoveryIssue) {
  activePath.value = issue.filePath
  activeOperation.value = `${issue.filePath}:restore`
  actionError.value = ''
  actionNotice.value = ''
  try {
    await store.recover(issue.filePath)
    const refreshed = await refreshLibraryKind(recoveryKind(issue.relativePath))
    if (refreshed)
      actionNotice.value = `${issue.relativePath} was restored from its last complete backup.`
    else
      actionError.value = `${issue.relativePath} was restored, but the in-memory library could not be refreshed. Retry the affected library page or restart Worship Studio.`
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    activePath.value = ''
    activeOperation.value = ''
  }
}

async function moveAside(issue: RecoveryIssue) {
  if (
    !(await confirmDialog.confirm(
      `Move ${issue.relativePath} out of the active library? The damaged bytes will be preserved, but this item will no longer appear in Worship Studio.`,
      'Preserve and Remove Damaged File',
    ))
  )
    return

  activePath.value = issue.filePath
  activeOperation.value = `${issue.filePath}:move`
  actionError.value = ''
  actionNotice.value = ''
  try {
    const destination = await store.quarantine(issue.filePath)
    const refreshed = await refreshLibraryKind(recoveryKind(issue.relativePath))
    if (refreshed) actionNotice.value = `The damaged file was preserved at ${destination}`
    else
      actionError.value = `The damaged file was preserved at ${destination}, but the in-memory library could not be refreshed. Retry the affected library page or restart Worship Studio.`
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    activePath.value = ''
    activeOperation.value = ''
  }
}
</script>

<template>
  <main class="health-page">
    <header class="health-hero">
      <div class="health-hero-copy">
        <span>Shared Library</span>
        <h1>Library Health</h1>
        <p>Recover damaged files and choose between versions changed on different computers.</p>
      </div>
      <div class="health-summary" aria-label="Library issue summary">
        <div :class="{ active: store.recoveryIssues.length }">
          <v-icon icon="mdi-file-restore-outline" size="20" />
          <strong>{{ store.recoveryIssues.length }}</strong>
          <span>Damaged</span>
        </div>
        <div :class="{ active: store.conflicts.length }">
          <v-icon icon="mdi-source-branch-sync" size="20" />
          <strong>{{ store.conflicts.length }}</strong>
          <span>Versions</span>
        </div>
      </div>
    </header>

    <AsyncLoadState
      v-if="!store.loaded"
      :loading="store.loading"
      :error="store.loadError"
      label="library health"
      @retry="store.load"
    />

    <template v-else>
      <AsyncLoadState
        v-if="store.loadError"
        :loading="false"
        :error="store.loadError"
        label="updated library health"
        compact
        @retry="store.load"
      />

      <v-alert v-if="actionError || store.mutationError" type="error" variant="tonal" closable class="health-alert" @click:close="actionError = ''; store.clearMutationError()">
        The library action could not be completed: {{ actionError || store.mutationError }}
      </v-alert>
      <v-alert v-if="actionNotice" type="success" variant="tonal" closable class="health-alert" @click:close="actionNotice = ''">
        {{ actionNotice }}
      </v-alert>

      <section v-if="store.recoveryIssues.length" class="health-section recovery-section">
        <header class="section-heading">
          <span class="section-icon is-error"><v-icon icon="mdi-file-alert-outline" size="22" /></span>
          <div>
            <h2>Damaged files</h2>
            <p>These files cannot be read. Restore a verified backup or preserve the damaged bytes outside the active library.</p>
          </div>
          <strong>{{ store.recoveryIssues.length }}</strong>
        </header>

        <div class="recovery-list">
          <article v-for="issue in store.recoveryIssues" :key="issue.filePath" class="recovery-card">
            <div class="recovery-status" :class="issue.backupAvailable ? 'has-backup' : 'no-backup'">
              <v-icon :icon="issue.backupAvailable ? 'mdi-backup-restore' : 'mdi-backup-restore-outline'" size="21" />
            </div>
            <div class="recovery-copy">
              <span>{{ issue.relativePath }}</span>
              <strong>{{ issue.backupAvailable ? 'A verified backup is available' : 'No valid automatic backup was found' }}</strong>
              <p>{{ issue.error }}</p>
            </div>
            <div class="recovery-actions">
              <v-btn v-if="issue.backupAvailable" color="primary" variant="flat" prepend-icon="mdi-backup-restore" :loading="activeOperation === `${issue.filePath}:restore`" :disabled="!!activePath" @click="restore(issue)">
                Restore Backup
              </v-btn>
              <v-btn color="warning" variant="tonal" prepend-icon="mdi-file-move-outline" :loading="activeOperation === `${issue.filePath}:move`" :disabled="!!activePath" @click="moveAside(issue)">
                Move Aside
              </v-btn>
            </div>
          </article>
        </div>
      </section>

      <section v-if="store.conflicts.length" class="health-section conflict-section">
        <header class="section-heading">
          <span class="section-icon is-warning"><v-icon icon="mdi-source-branch-sync" size="22" /></span>
          <div>
            <h2>Versions to review</h2>
            <p>Dropbox preserved both edits. Compare the changed fields and choose the version the shared library should keep.</p>
          </div>
          <strong>{{ store.conflicts.length }}</strong>
        </header>

        <div class="review-progress">
          <div>
            <strong>{{ resolvedConflictCount ? `${resolvedConflictCount} resolved` : 'Review each item' }}</strong>
            <span>{{ store.conflicts.length }} remaining</span>
          </div>
          <v-progress-linear :model-value="initialConflictCount ? (resolvedConflictCount / initialConflictCount) * 100 : 0" color="primary" height="5" rounded />
        </div>

        <article v-for="conflict in store.conflicts" :key="conflict.conflictFilePath" class="conflict-card">
          <header class="conflict-title">
            <span class="kind-badge"><v-icon icon="mdi-file-compare" size="18" />{{ kindLabel(conflict.kind) }}</span>
            <div>
              <h3>{{ conflict.label }}</h3>
              <p>{{ changedFields(conflict).length }} changed field{{ changedFields(conflict).length === 1 ? '' : 's' }}</p>
            </div>
          </header>

          <div class="version-identities">
            <div>
              <span>This computer</span>
              <strong>{{ deviceName(conflict.thisVersion.updatedByDevice, 'Current version') }}</strong>
              <small>Edited {{ formatWhen(conflict.thisVersion.updatedAt) }}</small>
            </div>
            <span class="compare-mark"><v-icon icon="mdi-compare-horizontal" size="20" /></span>
            <div>
              <span>Synced copy</span>
              <strong>{{ conflict.otherDevice }}</strong>
              <small>Edited {{ formatWhen(conflict.otherUpdatedAt) }}</small>
            </div>
          </div>

          <div class="field-comparison">
            <div class="comparison-header"><span>Changed field</span><span>This computer</span><span>{{ conflict.otherDevice }}</span></div>
            <div v-for="field in changedFields(conflict)" :key="field.key" class="comparison-row">
              <strong>{{ formatFieldName(field.key) }}</strong>
              <pre>{{ formatValue(field.thisValue) }}</pre>
              <pre>{{ formatValue(field.otherValue) }}</pre>
            </div>
            <p v-if="!changedFields(conflict).length" class="no-field-differences">Only the saved device or time differs between these versions.</p>
          </div>

          <footer class="conflict-actions">
            <div>
              <v-icon icon="mdi-information-outline" size="18" />
              <span>The unselected conflicted copy will be removed.</span>
            </div>
            <v-btn variant="outlined" :loading="activeOperation === `${conflict.conflictFilePath}:mine`" :disabled="!!activePath" @click="resolveConflict(conflict, 'mine')">Keep This Computer</v-btn>
            <v-btn color="primary" variant="flat" :loading="activeOperation === `${conflict.conflictFilePath}:theirs`" :disabled="!!activePath" @click="resolveConflict(conflict, 'theirs')">Keep {{ conflict.otherDevice }}</v-btn>
          </footer>
        </article>
      </section>

      <section v-if="issueCount === 0" class="healthy-panel">
        <LibraryEmptyState
          icon="mdi-shield-check-outline"
          :title="finishedReview ? 'Library review complete' : 'Your library is healthy'"
          :message="finishedReview ? 'All damaged files and synced versions have been handled. The affected library content has been refreshed.' : 'There are no damaged files or synced versions requiring review.'"
          compact
        >
          <v-btn color="primary" variant="flat" prepend-icon="mdi-calendar-month" @click="router.push('/')">Return to Services</v-btn>
          <v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="store.refreshing" @click="store.load">Check Again</v-btn>
        </LibraryEmptyState>
      </section>
    </template>
  </main>
</template>

<style scoped>
.health-page { max-width: 1180px; margin: 0 auto; padding: 30px 34px 64px; }
.health-hero { display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-bottom: 18px; padding: 22px 24px; border: 1px solid rgba(var(--v-theme-on-surface), .08); border-radius: 12px; background: radial-gradient(circle at 90% 0, rgba(var(--v-theme-primary), .11), transparent 240px), rgba(var(--v-theme-surface), .74); box-shadow: 0 12px 30px rgba(0,0,0,.07); }
.health-hero-copy > span { color: rgb(var(--v-theme-primary)); font-size: .66rem; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
.health-hero h1 { margin: 3px 0 0; font-size: 1.5rem; letter-spacing: -.025em; }
.health-hero p { max-width: 650px; margin: 7px 0 0; color: rgba(var(--v-theme-on-surface), .56); font-size: .78rem; }
.health-summary { display: grid; flex: 0 0 auto; grid-template-columns: repeat(2, 92px); gap: 8px; }
.health-summary > div { display: grid; grid-template-columns: 24px 1fr; align-items: center; padding: 9px 10px; border: 1px solid rgba(var(--v-theme-on-surface), .08); border-radius: 9px; background: rgba(var(--v-theme-background), .34); color: rgba(var(--v-theme-on-surface), .5); }
.health-summary > div.active { color: rgb(var(--v-theme-warning)); border-color: rgba(var(--v-theme-warning), .28); background: rgba(var(--v-theme-warning), .07); }
.health-summary > div:first-child.active { color: rgb(var(--v-theme-error)); border-color: rgba(var(--v-theme-error), .28); background: rgba(var(--v-theme-error), .07); }
.health-summary strong { font-size: 1rem; }
.health-summary span { grid-column: 1 / -1; margin-top: 2px; font-size: .6rem; font-weight: 700; text-transform: uppercase; }
.health-alert { margin-bottom: 14px; }
.health-section, .healthy-panel { overflow: hidden; margin-top: 16px; border: 1px solid rgba(var(--v-theme-on-surface), .09); border-radius: 12px; background: rgba(var(--v-theme-surface), .7); box-shadow: 0 10px 26px rgba(0,0,0,.055); }
.section-heading { display: grid; grid-template-columns: 42px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .08); }
.section-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 10px; }
.section-icon.is-error { color: rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), .1); }
.section-icon.is-warning { color: rgb(var(--v-theme-warning)); background: rgba(var(--v-theme-warning), .1); }
.section-heading h2 { margin: 0; font-size: .94rem; }
.section-heading p { margin: 3px 0 0; color: rgba(var(--v-theme-on-surface), .54); font-size: .7rem; line-height: 1.45; }
.section-heading > strong { display: grid; min-width: 27px; height: 27px; place-items: center; border-radius: 99px; background: rgba(var(--v-theme-on-surface), .07); font-size: .72rem; }
.recovery-list { display: grid; gap: 9px; padding: 14px; }
.recovery-card { display: grid; grid-template-columns: 44px minmax(0,1fr) auto; align-items: center; gap: 13px; padding: 13px; border: 1px solid rgba(var(--v-theme-error), .2); border-radius: 10px; background: rgba(var(--v-theme-background), .24); }
.recovery-status { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 9px; }
.recovery-status.has-backup { color: rgb(var(--v-theme-success)); background: rgba(var(--v-theme-success), .1); }
.recovery-status.no-backup { color: rgb(var(--v-theme-warning)); background: rgba(var(--v-theme-warning), .1); }
.recovery-copy { display: flex; min-width: 0; flex-direction: column; }
.recovery-copy > span { overflow: hidden; color: rgba(var(--v-theme-on-surface), .48); font-family: monospace; font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }
.recovery-copy strong { margin-top: 2px; font-size: .76rem; }
.recovery-copy p { margin: 3px 0 0; color: rgba(var(--v-theme-on-surface), .55); font-size: .68rem; overflow-wrap: anywhere; }
.recovery-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.review-progress { display: grid; gap: 8px; padding: 13px 18px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .07); background: rgba(var(--v-theme-primary), .025); }
.review-progress > div { display: flex; justify-content: space-between; font-size: .67rem; }
.review-progress span { color: rgba(var(--v-theme-on-surface), .5); }
.conflict-card { margin: 14px; border: 1px solid rgba(var(--v-theme-warning), .23); border-radius: 11px; background: rgba(var(--v-theme-background), .24); }
.conflict-title { display: flex; align-items: center; gap: 12px; padding: 14px 15px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .07); }
.kind-badge { display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 7px; color: rgb(var(--v-theme-warning)); background: rgba(var(--v-theme-warning), .1); font-size: .63rem; font-weight: 750; text-transform: uppercase; }
.conflict-title h3 { margin: 0; font-size: .9rem; }
.conflict-title p { margin: 2px 0 0; color: rgba(var(--v-theme-on-surface), .48); font-size: .65rem; }
.version-identities { display: grid; grid-template-columns: 1fr 34px 1fr; align-items: center; gap: 8px; padding: 13px 15px; }
.version-identities > div { display: flex; min-width: 0; flex-direction: column; padding: 10px 12px; border: 1px solid rgba(var(--v-theme-on-surface), .08); border-radius: 8px; }
.version-identities > div > span { color: rgba(var(--v-theme-on-surface), .45); font-size: .59rem; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
.version-identities strong { margin-top: 2px; overflow: hidden; font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.version-identities small { margin-top: 2px; color: rgba(var(--v-theme-on-surface), .5); font-size: .62rem; }
.compare-mark { display: grid; place-items: center; color: rgba(var(--v-theme-on-surface), .38); }
.field-comparison { margin: 0 15px 14px; overflow: hidden; border: 1px solid rgba(var(--v-theme-on-surface), .08); border-radius: 8px; }
.comparison-header, .comparison-row { display: grid; grid-template-columns: minmax(110px,.55fr) repeat(2,minmax(0,1fr)); }
.comparison-header { background: rgba(var(--v-theme-on-surface), .045); color: rgba(var(--v-theme-on-surface), .48); font-size: .58rem; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
.comparison-header span, .comparison-row > * { min-width: 0; padding: 8px 10px; border-right: 1px solid rgba(var(--v-theme-on-surface), .07); }
.comparison-header span:last-child, .comparison-row > *:last-child { border-right: 0; }
.comparison-row { border-top: 1px solid rgba(var(--v-theme-on-surface), .07); }
.comparison-row > strong { color: rgba(var(--v-theme-on-surface), .72); font-size: .67rem; }
.comparison-row pre { max-height: 150px; margin: 0; overflow: auto; color: rgba(var(--v-theme-on-surface), .78); font-family: inherit; font-size: .66rem; line-height: 1.42; white-space: pre-wrap; overflow-wrap: anywhere; }
.no-field-differences { margin: 0; padding: 18px; color: rgba(var(--v-theme-on-surface), .5); font-size: .7rem; text-align: center; }
.conflict-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 15px; border-top: 1px solid rgba(var(--v-theme-on-surface), .07); }
.conflict-actions > div { display: flex; flex: 1; align-items: center; gap: 6px; color: rgba(var(--v-theme-on-surface), .48); font-size: .65rem; }
.healthy-panel :deep(.library-empty) { min-height: 310px; }
@media (max-width: 760px) {
  .health-page { padding: 20px 16px 44px; }
  .health-hero { align-items: flex-start; flex-direction: column; }
  .health-summary { width: 100%; grid-template-columns: repeat(2,1fr); }
  .recovery-card { grid-template-columns: 44px minmax(0,1fr); }
  .recovery-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .comparison-header { display: none; }
  .comparison-row { grid-template-columns: 1fr 1fr; }
  .comparison-row > strong { grid-column: 1 / -1; border-right: 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .07); }
  .conflict-actions { align-items: stretch; flex-direction: column; }
  .conflict-actions > div { margin-bottom: 4px; }
}
@media (max-width: 500px) {
  .version-identities { grid-template-columns: 1fr; }
  .compare-mark { transform: rotate(90deg); }
  .comparison-row { grid-template-columns: 1fr; }
  .comparison-row pre { border-right: 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .07); }
}
</style>
