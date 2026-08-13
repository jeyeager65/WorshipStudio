<script setup lang="ts">
import { onMounted, ref, toRaw } from 'vue'
import { getAdapter } from '@/adapters'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { previewExternalAppCommand } from '@/utils/externalAppPreview'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { ExternalAppProfile } from '@/adapters/types'

const confirmDialog = useConfirmDialogStore()

// External App Profiles (spec section 12) — Windows-only, feature-detected same as Display
// Setup. Edited via a modal (design/sketches/external-app-profile.html) rather than inline like
// Theme Editor, since a profile has enough fields (launch config, remote controls, window
// position) to warrant its own focused surface.
const externalAppProfiles = ref<ExternalAppProfile[]>([])
async function loadExternalApps() {
  try {
    externalAppProfiles.value = (await getAdapter().externalApps?.listProfiles()) ?? []
  } catch (e) {
    console.error('Failed to list external app profiles:', e)
    externalAppProfiles.value = []
  }
}
const launchModeOptions: {
  title: string
  value: ExternalAppProfile['launchMode']
  hint: string
}[] = [
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

const profileDialogOpen = ref(false)
const editingProfile = ref<ExternalAppProfile>()

function blankExternalAppProfile(): ExternalAppProfile {
  return {
    id: crypto.randomUUID(),
    name: '',
    launchMode: 'launch-automatically',
    executablePath: '',
    parameterFormat: '',
    remoteControlsEnabled: false,
    nextKey: '',
    prevKey: '',
    updatedAt: '',
    updatedByDevice: '',
  }
}
function openNewExternalAppProfile() {
  editingProfile.value = blankExternalAppProfile()
  profileDialogOpen.value = true
}
function openEditExternalAppProfile(profile: ExternalAppProfile) {
  // toRaw first — profile is the reactive v-for item, and structuredClone can't clone a Vue
  // reactive Proxy directly (throws DataCloneError).
  editingProfile.value = structuredClone(toRaw(profile))
  profileDialogOpen.value = true
}
async function pickExternalAppExecutable() {
  const path = await getAdapter().externalApps?.pickExecutable()
  if (path && editingProfile.value) editingProfile.value.executablePath = path
}
async function saveExternalAppProfile() {
  if (!editingProfile.value) return
  await getAdapter().externalApps?.saveProfile(editingProfile.value)
  profileDialogOpen.value = false
  await loadExternalApps()
}
async function deleteExternalAppProfile(profile: ExternalAppProfile) {
  if (
    !(await confirmDialog.confirm(`Delete the "${profile.name}" external app profile?`, 'Delete'))
  )
    return
  await getAdapter().externalApps?.deleteProfile(profile.id)
  await loadExternalApps()
}

onMounted(loadExternalApps)
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
    <SettingsPanel
      title="App profiles"
      description="Define how presentation files open and how Worship Studio controls their windows."
      icon="mdi-application-cog-outline"
    >
      <template #action>
        <v-btn
          variant="flat"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openNewExternalAppProfile"
        >
          Add Profile
        </v-btn>
      </template>
      <v-list v-if="externalAppProfiles.length > 0" density="comfortable" class="settings-list">
        <v-list-item
          v-for="profile in externalAppProfiles"
          :key="profile.id"
          rounded="lg"
          class="mb-1"
          border
        >
          <template #prepend>
            <v-icon icon="mdi-application-outline" class="mr-3" />
          </template>
          <v-list-item-title class="font-weight-bold">{{
            profile.name || '(Unnamed)'
          }}</v-list-item-title>
          <v-list-item-subtitle>
            {{
              profile.launchMode === 'already-running' ? 'Already Running' : 'Launch Automatically'
            }}
          </v-list-item-subtitle>
          <template #append>
            <v-btn
              icon="mdi-pencil-outline"
              variant="text"
              size="small"
              @click.stop="openEditExternalAppProfile(profile)"
            />
            <v-btn
              icon="mdi-trash-can-outline"
              variant="text"
              size="small"
              color="error"
              @click.stop="deleteExternalAppProfile(profile)"
            />
          </template>
        </v-list-item>
      </v-list>
      <div v-else class="settings-empty">
        <v-icon icon="mdi-application-outline" size="28" />
        <span>No external app profiles configured yet.</span>
      </div>
    </SettingsPanel>

    <v-dialog v-model="profileDialogOpen" max-width="640">
      <v-card v-if="editingProfile">
        <v-card-title
          >External App Profile{{
            editingProfile.name ? ` — ${editingProfile.name}` : ''
          }}</v-card-title
        >
        <v-card-text>
          <v-text-field
            v-model="editingProfile.name"
            label="Name"
            variant="outlined"
            density="compact"
            class="mb-4"
          />

          <v-select
            v-model="editingProfile.launchMode"
            :items="launchModeOptions"
            item-title="title"
            item-value="value"
            label="Launch Mode"
            variant="outlined"
            density="compact"
            class="mb-4"
          >
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps" :subtitle="item.hint" />
            </template>
          </v-select>

          <v-text-field
            v-model="editingProfile.executablePath"
            label="Executable"
            variant="outlined"
            density="compact"
            hint="Used to launch the app and/or recognize its already-running process."
            persistent-hint
            class="mb-4"
          >
            <template #append>
              <v-btn variant="outlined" @click="pickExternalAppExecutable">Browse…</v-btn>
            </template>
          </v-text-field>

          <template v-if="editingProfile.launchMode === 'launch-automatically'">
            <v-text-field
              v-model="editingProfile.parameterFormat"
              label="Parameter Format"
              variant="outlined"
              density="compact"
              hint="{file} is replaced with the file chosen when this app is added to a service."
              persistent-hint
              class="mb-1"
            />
            <div class="param-preview mb-4">
              Will run:
              {{
                previewExternalAppCommand(
                  editingProfile.executablePath,
                  editingProfile.parameterFormat,
                )
              }}
            </div>
          </template>

          <v-divider class="my-5" />

          <div class="d-flex align-center justify-space-between mb-3">
            <div>
              <div class="font-weight-bold">Basic Remote Controls</div>
              <div class="text-caption text-medium-emphasis">
                Let Next/Prev and the remote control also drive this app, if it supports simple
                commands
              </div>
            </div>
            <v-switch v-model="editingProfile.remoteControlsEnabled" color="primary" hide-details />
          </div>
          <template v-if="editingProfile.remoteControlsEnabled">
            <v-text-field
              v-model="editingProfile.nextKey"
              label="Next slide key"
              placeholder="e.g. Right Arrow"
              variant="outlined"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="editingProfile.prevKey"
              label="Previous slide key"
              placeholder="e.g. Left Arrow"
              variant="outlined"
              density="compact"
              class="mb-1"
            />
            <div class="text-caption text-medium-emphasis mb-2">
              Sent as a keystroke to the app's window when Next/Prev is pressed while this item is
              live. Leave blank if the app doesn't support this.
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="profileDialogOpen = false">Cancel</v-btn>
          <v-btn variant="flat" color="primary" @click="saveExternalAppProfile">Save Profile</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.settings-list {
  max-width: 680px;
  padding: 0;
  background: transparent;
}
.settings-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 92px;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 9px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.73rem;
}
.param-preview {
  font-family: monospace;
  font-size: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border-radius: 6px;
  padding: 8px 10px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
