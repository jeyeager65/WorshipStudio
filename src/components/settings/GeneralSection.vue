<script setup lang="ts">
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'

const router = useRouter()
const { machineSettings } = storeToRefs(useSettingsStore())

// Re-running the wizard doesn't reset hasCompletedSetup — that only matters for whether it
// auto-opens on next launch (App.vue), and this is an explicit, already-past-first-launch visit.
function runSetupWizard() {
  router.push('/setup')
}
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
    <SettingsPanel
      title="Workstation identity"
      description="Used to distinguish this computer when synchronized files conflict."
      icon="mdi-laptop"
    >
      <v-text-field
        v-model="machineSettings!.thisComputerName"
        label="Computer name"
        variant="outlined"
        density="compact"
        hide-details
        class="settings-form-field"
      />
    </SettingsPanel>
    <SettingsPanel
      title="Guided setup"
      description="Review the initial library, display, and service configuration."
      icon="mdi-magic-staff"
    >
      <v-btn
        variant="outlined"
        color="primary"
        prepend-icon="mdi-magic-staff"
        @click="runSetupWizard"
      >
        Run Setup Wizard
      </v-btn>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.settings-form-field {
  max-width: 520px;
}
</style>
