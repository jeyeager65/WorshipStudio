<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getAdapter } from '@/adapters'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { ExternalAppProfile } from '@/adapters/types'

const router = useRouter()
const confirmDialog = useConfirmDialogStore()

// External App Profiles (spec section 12) — profile CRUD (this list) works on every adapter,
// shared/synced data like any other library content; only the per-machine executable path and
// actual launching are Windows/Tauri-only (see ExternalAppProfileEditorView's own "On This
// Computer" section, and ExternalAppPort's doc comment). Editing lives on its own routed page
// (ExternalAppProfileEditorView.vue) rather than inline or in a dialog — Basic Remote Controls'
// key-commands list made a dialog grow past what a modal can reasonably hold, the same reasoning
// ServiceTemplateEditorView/RolesView already settled on for their own multi-field editors.
const externalAppProfiles = ref<ExternalAppProfile[]>([])
async function loadExternalApps() {
  try {
    externalAppProfiles.value = await getAdapter().externalApps.listProfiles()
  } catch (e) {
    console.error('Failed to list external app profiles:', e)
    externalAppProfiles.value = []
  }
}
function openNewExternalAppProfile() {
  void router.push({ name: 'external-app-profile-new' })
}
function openEditExternalAppProfile(profile: ExternalAppProfile) {
  void router.push({ name: 'external-app-profile-editor', params: { profileId: profile.id } })
}
async function deleteExternalAppProfile(profile: ExternalAppProfile) {
  if (
    !(await confirmDialog.confirm(`Delete the "${profile.name}" external app profile?`, 'Delete'))
  )
    return
  await getAdapter().externalApps.deleteProfile(profile.id)
  await loadExternalApps()
}

// Starter profiles for common apps (PowerPoint, VLC, ...) — same "one-off bulk library action"
// category as LibrarySyncSection.vue's Add Stock Backgrounds, and just as safe to click more than
// once (matched by a stable id, never duplicates or overwrites an already-edited profile).
const addingDefaultProfiles = ref(false)
const defaultProfilesAdded = ref<number>()
async function addDefaultExternalAppProfiles() {
  addingDefaultProfiles.value = true
  defaultProfilesAdded.value = undefined
  try {
    defaultProfilesAdded.value = await getAdapter().externalApps.importDefaultProfiles()
    await loadExternalApps()
  } finally {
    addingDefaultProfiles.value = false
  }
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
        <div class="d-flex ga-2">
          <v-btn
            variant="outlined"
            :loading="addingDefaultProfiles"
            prepend-icon="mdi-auto-fix"
            @click="addDefaultExternalAppProfiles"
          >
            Add Suggested Profiles
          </v-btn>
          <v-btn
            variant="flat"
            color="primary"
            prepend-icon="mdi-plus"
            @click="openNewExternalAppProfile"
          >
            Add Profile
          </v-btn>
        </div>
      </template>
      <div v-if="defaultProfilesAdded !== undefined" class="text-caption text-medium-emphasis mb-3">
        {{
          defaultProfilesAdded > 0
            ? `Added ${defaultProfilesAdded} profile${defaultProfilesAdded === 1 ? '' : 's'} — on the computer that presents, check each one's "On This Computer" section, since the install location couldn't always be found automatically.`
            : 'Every suggested profile is already here.'
        }}
      </div>
      <v-list v-if="externalAppProfiles.length > 0" density="comfortable" class="settings-list">
        <v-list-item
          v-for="profile in externalAppProfiles"
          :key="profile.id"
          rounded="lg"
          class="mb-1 app-profile-item"
          border
          @click="openEditExternalAppProfile(profile)"
        >
          <template #prepend>
            <span class="app-profile-icon"><v-icon icon="mdi-application-outline" /></span>
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
  </div>
</template>

<style scoped>
.settings-list {
  padding: 0;
  background: transparent;
}
.app-profile-item {
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}
.app-profile-item:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.04);
}
.app-profile-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  margin-right: 14px;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
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
</style>
