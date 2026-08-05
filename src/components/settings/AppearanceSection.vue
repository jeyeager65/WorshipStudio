<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useTheme } from 'vuetify'
import { useSettingsStore } from '@/stores/settings'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'

const { machineSettings } = storeToRefs(useSettingsStore())
const theme = useTheme()

const darkMode = computed({
  get: () => machineSettings.value?.darkMode ?? true,
  set: (value: boolean) => {
    if (!machineSettings.value) return
    machineSettings.value.darkMode = value
    theme.change(value ? 'worshipDark' : 'worshipLight')
  },
})
</script>

<template>
  <SettingsPanel
    title="Operator interface"
    description="Choose how Worship Studio looks on this computer."
    icon="mdi-theme-light-dark"
  >
    <div class="settings-toggle-row">
      <div>
        <strong>Dark mode</strong>
        <p>Use a darker interface that is easier on the eyes in the booth.</p>
      </div>
      <v-switch v-model="darkMode" color="primary" hide-details aria-label="Dark mode" />
    </div>
  </SettingsPanel>
</template>

<style scoped>
.settings-toggle-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}
.settings-toggle-row strong {
  display: block;
  font-size: 0.82rem;
}
.settings-toggle-row p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.69rem;
  line-height: 1.45;
}
</style>
