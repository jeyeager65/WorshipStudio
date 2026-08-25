<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { getAdapter } from '@/adapters'
import { errorMessage } from '@/composables/useAsyncStoreState'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { previewExternalAppCommand } from '@/utils/externalAppPreview'
import { RESERVED_SHORTCUTS } from '@/utils/keyCombo'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import KeyComboField from '@/components/settings/KeyComboField.vue'
import type { ExternalAppProfile } from '@/adapters/types'

// External App Profiles (spec section 12) — its own routed page rather than a dialog
// (ExternalAppsSection.vue's list, `/settings` with ?section=external-apps) once Basic Remote
// Controls' key-commands list made the dialog grow past what a modal can reasonably hold.
// Header/section styling matches the app's established editor-page convention
// (SongEditorView.vue/PersonEditorView.vue's `.editor-header`/`.editor-section` — bordered card
// sections, not ServiceTemplateEditorView's plainer one, which predates that convention). Save/
// undo/redo also match that same convention — the app-bar's own Save/Undo/Redo buttons
// (App.vue), driven by this page registering itself with useUnsavedChangesStore/
// useDocumentHistory, rather than a bespoke in-page Save button.
const route = useRoute()
const router = useRouter()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())

const loading = ref(true)
const loadError = ref('')
const missingProfile = ref(false)
const workingProfile = ref<ExternalAppProfile>()
const saveError = ref('')
const documentHistory = useDocumentHistory(workingProfile, 'external app profile')

// Per-machine, not part of the shared/synced profile above (see ExternalAppImplementation's own
// doc comment) — undefined until getImplementation resolves, so the field starting blank on a
// fresh-loading page doesn't get mistaken for "no implementation here yet" and trigger a save.
// Only ever populated/editable where the port supports it (Tauri) — stays hidden otherwise (see
// implementationSupported below), since there's nothing for a web/tablet session to browse for.
const implementationExecutablePath = ref<string>()
const implementationSaving = ref(false)
const implementationError = ref('')
const implementationSupported = computed(
  () => !!getAdapter().externalApps.getImplementation && !!getAdapter().externalApps.saveImplementation,
)
let suppressImplementationWatch = false

const heading = computed(() => workingProfile.value?.name.trim() || 'New External App Profile')

const launchModeOptions: { title: string; value: ExternalAppProfile['launchMode']; hint: string }[] = [
  {
    title: 'Already Running',
    value: 'already-running',
    hint: 'Operator opens it manually before the service',
  },
  {
    title: 'Launch Automatically',
    value: 'launch-automatically',
    hint: 'Worship Studio opens it when the slide is reached',
  },
]

const kindOptions: { title: string; value: ExternalAppProfile['kind'] }[] = [
  { title: 'Presentation', value: 'presentation' },
  { title: 'Video Player', value: 'video' },
  { title: 'Other', value: 'custom' },
]

function blankProfile(): ExternalAppProfile {
  return {
    id: crypto.randomUUID(),
    name: '',
    kind: 'custom',
    launchMode: 'launch-automatically',
    parameterFormat: '',
    remoteControlsEnabled: false,
    allowedExtensions: [],
    // A convenience default, not special-cased anywhere else — fully editable/deletable/
    // rebindable like any command the operator adds themselves.
    keyCommands: [
      { id: crypto.randomUUID(), label: 'Next', keyCombo: '', triggerKey: 'Right' },
      { id: crypto.randomUUID(), label: 'Previous', keyCombo: '', triggerKey: 'Left' },
    ],
    updatedAt: '',
    updatedByDevice: '',
  }
}

// Comma-separated in the UI, a plain string array on the model — mirrors Tags fields elsewhere
// (v-combobox) but this is deliberately a plain text field instead: extensions are typed, not
// picked from existing values, and there's no library-wide list of "known extensions" to offer.
const allowedExtensionsInput = computed({
  get: () => (workingProfile.value?.allowedExtensions ?? []).join(', '),
  set: (value: string) => {
    if (!workingProfile.value) return
    workingProfile.value.allowedExtensions = value
      .split(',')
      .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean)
  },
})

onMounted(initialize)

async function loadImplementation(profileId: string) {
  implementationExecutablePath.value = undefined
  const getImplementation = getAdapter().externalApps.getImplementation
  if (!getImplementation) return
  const implementation = await getImplementation(profileId)
  // Consumed by the watcher below on its very next fire — this assignment is a *load*, not a
  // user edit, so it must not immediately turn around and "save" the value it just read back
  // (which, for a profile with no implementation on this machine yet, would wrongly create an
  // empty one just from opening the page).
  suppressImplementationWatch = true
  implementationExecutablePath.value = implementation?.executablePath ?? ''
}

async function initialize() {
  documentHistory.stop()
  loading.value = true
  loadError.value = ''
  missingProfile.value = false
  if (route.name === 'external-app-profile-new') {
    workingProfile.value = blankProfile()
    await loadImplementation(workingProfile.value.id)
    loading.value = false
    isDirty.value = true
    documentHistory.start((dirty) => (isDirty.value = dirty), true)
    saveHandler.value = save
    return
  }
  const id = String(route.params.profileId ?? '')
  try {
    const profiles = await getAdapter().externalApps.listProfiles()
    const found = profiles.find((profile) => profile.id === id)
    if (!found) {
      missingProfile.value = true
      return
    }
    workingProfile.value = found
    await loadImplementation(found.id)
    isDirty.value = false
    documentHistory.start((dirty) => (isDirty.value = dirty), false)
    saveHandler.value = save
  } catch (e) {
    loadError.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
})

async function pickExecutable() {
  const path = await getAdapter().externalApps.pickExecutable?.()
  if (!path || !workingProfile.value) return
  // "Already Running" only ever matches by process name (see win32::find_running_process_id) —
  // the full path a picked file carries would just be misleading here, since it's never checked
  // against this computer's own install location the way "Launch Automatically" mode's Executable
  // field is.
  implementationExecutablePath.value =
    workingProfile.value.launchMode === 'already-running' ? (path.split(/[/\\]/).pop() ?? path) : path
}

// Per-machine, so it saves immediately on its own rather than being queued behind the app-bar's
// Save button alongside the shared profile above (that button — and undo/redo — only ever cover
// `workingProfile`; this field isn't part of that document at all any more, see
// implementationExecutablePath's own doc comment). The suppressImplementationWatch flag skips
// the one change loadImplementation itself causes, so opening the page never immediately
// re-saves the value it just read back (which, for a not-yet-implemented profile, would wrongly
// create an empty record just from opening the editor).
watch(implementationExecutablePath, async (path) => {
  if (suppressImplementationWatch) {
    suppressImplementationWatch = false
    return
  }
  if (path === undefined || !workingProfile.value) return
  const saveImplementation = getAdapter().externalApps.saveImplementation
  if (!saveImplementation) return
  implementationSaving.value = true
  implementationError.value = ''
  try {
    await saveImplementation(workingProfile.value.id, path ?? '')
  } catch (e) {
    implementationError.value = errorMessage(e)
  } finally {
    implementationSaving.value = false
  }
})

function addCommand() {
  workingProfile.value?.keyCommands.push({ id: crypto.randomUUID(), label: '', keyCombo: '' })
}
function removeCommand(commandId: string) {
  if (!workingProfile.value) return
  workingProfile.value.keyCommands = workingProfile.value.keyCommands.filter(
    (command) => command.id !== commandId,
  )
}

// Non-blocking — any key can still be bound (see keyCombo.ts's own doc comment on the resolved
// "override with a warning, not a hard block" decision); this is purely so the operator knows
// they're about to override something Worship Studio itself already uses that key for.
function reservedShortcutWarning(triggerKey: string | undefined): string | undefined {
  if (!triggerKey) return undefined
  const match = RESERVED_SHORTCUTS.find((reserved) => reserved.combo === triggerKey)
  return match
    ? `This overrides Worship Studio's own "${match.label}" shortcut while this item is live.`
    : undefined
}

function backToList() {
  void router.push({ name: 'settings', query: { section: 'external-apps' } })
}

async function save() {
  if (!workingProfile.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await getAdapter().externalApps.saveProfile(workingProfile.value)
    isDirty.value = false
    backToList()
  } catch (e) {
    saveError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="external-app-editor-page">
    <header class="editor-header">
      <div class="header-content">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" class="back-button" @click="backToList">
          External Apps
        </v-btn>
        <div class="title-copy">
          <div class="eyebrow">External App Profile</div>
          <h1>{{ heading }}</h1>
          <p>Define how presentation files open and how Worship Studio controls their windows.</p>
        </div>
      </div>
    </header>

    <div class="editor-content">
      <v-alert
        v-if="saveError"
        type="error"
        variant="tonal"
        closable
        @click:close="saveError = ''"
      >
        The profile could not be saved: {{ saveError }}
      </v-alert>

      <AsyncLoadState
        v-if="loading || loadError"
        :loading="loading"
        :error="loadError"
        label="external app profile"
        @retry="initialize"
      />
      <section v-else-if="missingProfile" class="missing-state">
        <v-icon icon="mdi-application-outline" size="38" />
        <h2>Profile Not Found</h2>
        <p>It may have been renamed or removed on another computer.</p>
        <v-btn color="primary" variant="flat" @click="backToList">Return to External Apps</v-btn>
      </section>
      <template v-else-if="workingProfile">
        <section class="editor-section">
          <div class="section-heading">
            <div class="section-icon">
              <v-icon icon="mdi-application-cog-outline" />
            </div>
            <div>
              <h2>Launch Configuration</h2>
              <p>How Worship Studio finds or starts this app.</p>
            </div>
          </div>

          <div class="details-grid mb-4">
            <v-text-field
              v-model="workingProfile.name"
              label="Name"
              variant="outlined"
              density="compact"
              hide-details
            />
            <v-select
              v-model="workingProfile.kind"
              :items="kindOptions"
              item-title="title"
              item-value="value"
              label="Kind"
              hint="Just drives the icon shown for this app — has no effect on how it launches."
              persistent-hint
              variant="outlined"
              density="compact"
            />
            <v-select
              v-model="workingProfile.launchMode"
              :items="launchModeOptions"
              item-title="title"
              item-value="value"
              label="Launch Mode"
              variant="outlined"
              density="compact"
              hide-details
            >
              <template #item="{ item, props: itemProps }">
                <v-list-item v-bind="itemProps" :subtitle="item.hint" />
              </template>
            </v-select>
            <v-text-field
              v-model="allowedExtensionsInput"
              label="Allowed File Extensions (optional)"
              placeholder="e.g. pptx, ppt"
              hint="Limits which files can be picked for this app. Leave blank to allow any file."
              persistent-hint
              variant="outlined"
              density="compact"
            />
          </div>

          <template v-if="workingProfile.launchMode === 'launch-automatically'">
            <v-text-field
              v-model="workingProfile.parameterFormat"
              label="Parameter Format"
              variant="outlined"
              density="compact"
              hint="{file} is replaced with the file chosen when this app is added to a service."
              persistent-hint
              class="mb-1"
            />
            <div class="param-preview">
              Will run:
              {{ previewExternalAppCommand(implementationExecutablePath, workingProfile.parameterFormat) }}
            </div>
          </template>
        </section>

        <section v-if="implementationSupported" class="editor-section">
          <div class="section-heading">
            <div class="section-icon">
              <v-icon icon="mdi-desktop-classic" />
            </div>
            <div>
              <h2>On This Computer</h2>
              <p>
                Where this app actually lives here — every other computer that presents needs its
                own copy of this filled in too, since an install path is never the same on two
                machines.
              </p>
            </div>
          </div>

          <v-text-field
            v-model="implementationExecutablePath"
            :label="workingProfile.launchMode === 'already-running' ? 'Process Name' : 'Executable'"
            variant="outlined"
            density="compact"
            :hint="
              workingProfile.launchMode === 'already-running'
                ? 'e.g. OBS64.exe — just the process name Worship Studio looks for. It does not need to exist on this computer or match an install path; type it directly, or Browse to fill it in from an installed copy.'
                : 'The program Worship Studio launches for this item, on this computer.'
            "
            persistent-hint
            :loading="implementationSaving"
            hide-details="auto"
            :error-messages="implementationError ? [implementationError] : []"
          >
            <template #append>
              <v-btn variant="outlined" @click="pickExecutable">Browse…</v-btn>
            </template>
          </v-text-field>
        </section>

        <section class="editor-section">
          <div class="section-heading section-heading--action">
            <div class="section-icon section-icon--remote">
              <v-icon icon="mdi-remote" />
            </div>
            <div>
              <h2>Basic Remote Controls</h2>
              <p>
                Named commands sent as a keystroke to this app's window — each always gets a
                button (here and on the remote control), and can optionally also fire from a key
                on your own keyboard while this item is live.
              </p>
            </div>
            <v-switch v-model="workingProfile.remoteControlsEnabled" color="primary" hide-details />
          </div>
          <template v-if="workingProfile.remoteControlsEnabled">
            <VueDraggable
              v-model="workingProfile.keyCommands"
              handle=".command-drag-handle"
              :animation="150"
              class="d-flex flex-column ga-3 mb-3"
            >
              <div v-for="(command, index) in workingProfile.keyCommands" :key="command.id" class="key-command-row">
                <div class="d-flex align-center ga-2 mb-1">
                  <v-icon
                    icon="mdi-drag-vertical"
                    class="command-drag-handle"
                    size="20"
                  />
                  <span class="command-number">{{ index + 1 }}</span>
                  <v-text-field
                    v-model="command.label"
                    label="Name"
                    placeholder="e.g. Start Presentation"
                    variant="outlined"
                    density="compact"
                    hide-details
                    class="flex-grow-1"
                  />
                  <v-btn
                    icon="mdi-delete-outline"
                    variant="text"
                    size="small"
                    title="Remove command"
                    aria-label="Remove command"
                    @click="removeCommand(command.id)"
                  />
                </div>
                <div class="details-grid">
                  <div>
                    <div class="text-caption text-medium-emphasis mb-1">Sends to the app</div>
                    <KeyComboField v-model="command.keyCombo" />
                  </div>
                  <div>
                    <div class="text-caption text-medium-emphasis mb-1">Keyboard trigger (optional)</div>
                    <KeyComboField v-model="command.triggerKey" placeholder="Button only" />
                  </div>
                </div>
                <div
                  v-if="reservedShortcutWarning(command.triggerKey)"
                  class="text-caption text-warning mt-1"
                >
                  {{ reservedShortcutWarning(command.triggerKey) }}
                </div>
              </div>
            </VueDraggable>
            <div class="text-caption text-medium-emphasis mb-3">
              Drag to reorder — this also controls the order of the buttons on the remote control
              and in the workspace.
            </div>
            <v-btn variant="outlined" size="small" prepend-icon="mdi-plus" @click="addCommand">
              Add Command
            </v-btn>
          </template>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.external-app-editor-page {
  min-height: 100%;
  background:
    radial-gradient(circle at 76% 0, rgba(var(--v-theme-primary), 0.05), transparent 420px),
    rgb(var(--v-theme-background));
}

.editor-header {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-surface), 0.76);
}

.header-content,
.editor-content {
  width: min(100%, 900px);
  margin: 0 auto;
}

.header-content {
  padding: 18px 32px 24px;
}

.back-button {
  margin: 0 0 9px -12px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  text-transform: none;
}

.title-copy {
  min-width: 0;
}

.eyebrow {
  margin-bottom: 2px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.title-copy h1 {
  overflow: hidden;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.96);
  font-size: clamp(1.55rem, 2.5vw, 2rem);
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-copy p {
  margin: 5px 0 0;
  max-width: 700px;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.78rem;
}

.editor-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px 32px 52px;
}

.editor-section {
  padding: 22px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}

.section-heading {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  margin-bottom: 20px;
}

.section-heading--action {
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
}

.section-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.section-icon--remote {
  background: rgba(var(--v-theme-teal), 0.12);
  color: rgb(var(--v-theme-teal));
}

.section-heading h2 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1rem;
  font-weight: 700;
}

.section-heading p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.76rem;
  line-height: 1.5;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 15px;
}

.editor-section :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.48);
}

.missing-state {
  display: flex;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 13px;
  background: rgba(var(--v-theme-surface), 0.65);
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: center;
}
.missing-state h2 {
  margin: 13px 0 4px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
}
.missing-state p {
  margin: 0 0 18px;
  font-size: 0.75rem;
}

.key-command-row {
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.4);
}

.command-drag-handle {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.42);
  cursor: grab;
}

.command-drag-handle:active {
  cursor: grabbing;
}

.command-number {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border-radius: 6px;
  background: rgba(var(--v-theme-primary), 0.13);
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 700;
}

.param-preview {
  font-family: monospace;
  font-size: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px 10px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

@media (max-width: 700px) {
  .details-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .section-heading--action {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .section-heading--action .v-switch {
    grid-column: 1 / -1;
    justify-self: start;
    margin-top: 8px;
  }
}
</style>
