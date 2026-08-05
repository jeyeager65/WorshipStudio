<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'

const { librarySettings } = storeToRefs(useSettingsStore())
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
  <SettingsPanel
    title="Scripture"
    description="Text auto-fits within this range. Content that still does not fit at the minimum splits at verse boundaries."
    icon="mdi-book-open-variant"
  >
    <div class="number-field-grid">
      <v-text-field
        v-model.number="librarySettings!.scriptureMinFontSizePx"
        label="Minimum size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
      <v-text-field
        v-model.number="librarySettings!.scriptureMaxFontSizePx"
        label="Maximum size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
    </div>
  </SettingsPanel>

  <SettingsPanel
    title="Song lyrics"
    description="Each song part stays on one slide. Lines wrap only when needed and never break mid-word."
    icon="mdi-music-note-outline"
  >
    <div class="number-field-grid">
      <v-text-field
        v-model.number="librarySettings!.songMinFontSizePx"
        label="Minimum size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
      <v-text-field
        v-model.number="librarySettings!.songMaxFontSizePx"
        label="Maximum size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
    </div>
  </SettingsPanel>

  <SettingsPanel
    title="Header and footer"
    description="Fixed sizes for references and translation labels surrounding slide content."
    icon="mdi-page-layout-header-footer"
  >
    <div class="number-field-grid">
      <v-text-field
        v-model.number="librarySettings!.slideHeaderFontSizePx"
        label="Header size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
      <v-text-field
        v-model.number="librarySettings!.slideFooterFontSizePx"
        label="Footer size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
    </div>
  </SettingsPanel>

  <SettingsPanel
    title="Wayfinding display"
    description="Controls the surrounding book names and centered reference. Large values can overflow long references."
    icon="mdi-sign-direction"
  >
    <div class="number-field-grid">
      <v-text-field
        v-model.number="librarySettings!.wayfindingMinFontSizePx"
        label="Minimum size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
      <v-text-field
        v-model.number="librarySettings!.wayfindingMaxFontSizePx"
        label="Maximum size (px)"
        type="number"
        variant="outlined"
        density="compact"
        min="1"
        hide-details
      />
    </div>
  </SettingsPanel>
  </div>
</template>

<style scoped>
.number-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 190px));
  gap: 12px;
}
@media (max-width: 460px) {
  .number-field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
