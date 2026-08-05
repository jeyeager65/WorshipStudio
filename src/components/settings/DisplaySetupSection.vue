<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { needsSingleMonitorFallback } from '@/utils/displaySetup'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { DisplayInfo, DisplayRole } from '@/adapters/types'

const { machineSettings } = storeToRefs(useSettingsStore())

// Windows-only in practice (spec section 17); the port is entirely absent on builds where it
// doesn't apply, feature-detected here rather than assumed present.
const displays = ref<DisplayInfo[]>([])
const loadingDisplays = ref(false)
const roleOptions: { title: string; value: DisplayRole }[] = [
  { title: 'Operator (this window)', value: 'operator' },
  { title: 'Audience Display', value: 'audience' },
  { title: 'Not Used', value: 'not-used' },
]
async function loadDisplays() {
  // Not wired to a real command on the native Tauri backend yet (README's adapter-status
  // note) — falls back to "no displays detected" rather than leaving an unhandled rejection.
  loadingDisplays.value = true
  try {
    displays.value = (await getAdapter().displays?.list()) ?? []
  } catch (e) {
    console.error('Failed to list displays:', e)
    displays.value = []
  } finally {
    loadingDisplays.value = false
  }
}
// Role assignment is an immediate hardware-config action, not a staged edit like the rest
// of this screen — there's nothing meaningful to "revert" before Save, so it applies (and
// persists) right away.
async function assignRole(displayId: string, role: DisplayRole) {
  await getAdapter().displays?.assignRole(displayId, role)
  const display = displays.value.find((d) => d.id === displayId)
  if (display) display.role = role
  // Keep the staged settings model aligned with the immediate backend write so a later Save
  // on this page cannot put the previous display role map back.
  if (machineSettings.value) machineSettings.value.displayRoles[displayId] = role
}
async function identifyDisplay(displayId: string) {
  await getAdapter().displays?.identify(displayId)
}

onMounted(loadDisplays)
</script>

<template>
  <SettingsPanel
    title="Connected displays"
    description="Assign what each monitor shows. Changes take effect immediately."
    icon="mdi-monitor-multiple"
  >
    <template #action>
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-refresh"
        :loading="loadingDisplays"
        @click="loadDisplays"
      >
        Refresh
      </v-btn>
    </template>
    <v-alert v-if="needsSingleMonitorFallback(displays)" type="info" variant="tonal" class="mb-4">
      Only one display detected. You can plan services and use 16:9 previews on this computer,
      but presenting requires a separate audience display in extended-desktop mode.
    </v-alert>
    <div v-if="displays.length === 0" class="settings-empty">
      <v-icon icon="mdi-monitor-off" size="28" />
      <span>No displays detected.</span>
    </div>
    <div v-for="display in displays" :key="display.id" class="display-setting-row">
      <div class="display-setting-copy">
        <strong>{{ display.name }}</strong>
        <span>{{ display.resolution }}</span>
      </div>
      <v-select
        :model-value="display.role"
        :items="roleOptions"
        label="Role"
        variant="outlined"
        density="compact"
        hide-details
        :disabled="needsSingleMonitorFallback(displays)"
        @update:model-value="(role: DisplayRole) => assignRole(display.id, role)"
      />
      <v-btn variant="outlined" color="secondary" @click="identifyDisplay(display.id)">
        Identify
      </v-btn>
    </div>
  </SettingsPanel>
</template>

<style scoped>
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
.display-setting-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 260px auto;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.display-setting-row:last-child {
  border-bottom: 0;
}
.display-setting-copy {
  min-width: 0;
}
.display-setting-copy strong {
  display: block;
  font-size: 0.82rem;
}
.display-setting-copy span {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.69rem;
  line-height: 1.45;
}
@media (max-width: 900px) {
  .display-setting-row {
    grid-template-columns: minmax(130px, 1fr) 220px;
  }
  .display-setting-row > .v-btn {
    grid-column: 2;
    justify-self: end;
  }
}
@media (max-width: 700px) {
  .display-setting-row {
    grid-template-columns: 1fr;
  }
  .display-setting-row > .v-btn {
    grid-column: auto;
    justify-self: start;
  }
}
</style>
