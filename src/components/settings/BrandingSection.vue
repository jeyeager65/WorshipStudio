<script setup lang="ts">
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import MediaPickerDialog from '@/components/media/MediaPickerDialog.vue'

const { librarySettings } = storeToRefs(useSettingsStore())

const brandingLogoPickerOpen = ref(false)
const brandingLogoPreviewUrl = ref<string>()
const brandingLogoLoading = ref(false)

watch(
  () => librarySettings.value?.branding.logoMediaId,
  async (mediaId) => {
    brandingLogoPreviewUrl.value = undefined
    if (!mediaId) return
    brandingLogoLoading.value = true
    try {
      const url = await getAdapter().media.getPreviewUrl(mediaId)
      // Do not let a slower request for the previous logo replace a newer selection.
      if (librarySettings.value?.branding.logoMediaId === mediaId)
        brandingLogoPreviewUrl.value = url
    } catch (error) {
      console.error('Failed to load branding logo:', error)
    } finally {
      if (librarySettings.value?.branding.logoMediaId === mediaId) brandingLogoLoading.value = false
    }
  },
  { immediate: true },
)

function selectBrandingLogo(mediaId: string) {
  if (librarySettings.value) librarySettings.value.branding.logoMediaId = mediaId
}

function removeBrandingLogo() {
  if (!librarySettings.value) return
  librarySettings.value.branding.logoMediaId = undefined
  brandingLogoPreviewUrl.value = undefined
}

function setBrandingColor(which: 'primaryColor' | 'secondaryColor', event: Event) {
  if (!librarySettings.value) return
  librarySettings.value.branding[which] = (event.target as HTMLInputElement).value.toUpperCase()
}
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
    <SettingsPanel
      title="Church identity"
      description="The name used on reports, bulletins, and exported documents."
      icon="mdi-church-outline"
    >
      <v-text-field
        v-model="librarySettings!.branding.churchName"
        label="Church or ministry name"
        placeholder="First Community Church"
        variant="outlined"
        density="comfortable"
        hide-details
        class="branding-name-field"
      />
    </SettingsPanel>

    <SettingsPanel
      title="Logo"
      description="Choose a synced image so the logo is available on every computer using this library."
      icon="mdi-image-outline"
    >
      <div class="branding-logo-layout">
        <div class="branding-logo-preview">
          <v-progress-circular v-if="brandingLogoLoading" indeterminate color="primary" size="28" />
          <img
            v-else-if="brandingLogoPreviewUrl"
            :src="brandingLogoPreviewUrl"
            :alt="`${librarySettings!.branding.churchName || 'Church'} logo`"
          />
          <template v-else>
            <v-icon icon="mdi-image-outline" size="31" />
            <span>{{
              librarySettings!.branding.logoMediaId
                ? 'Logo preview unavailable'
                : 'No logo selected'
            }}</span>
          </template>
        </div>
        <div class="branding-logo-copy">
          <strong>Church logo</strong>
          <p>
            A transparent PNG works best. The original image remains in the Media Library and can be
            reused elsewhere.
          </p>
          <div>
            <v-btn
              variant="flat"
              color="primary"
              prepend-icon="mdi-image-search-outline"
              @click="brandingLogoPickerOpen = true"
            >
              {{ librarySettings!.branding.logoMediaId ? 'Change Logo' : 'Choose Logo' }}
            </v-btn>
            <v-btn
              v-if="librarySettings!.branding.logoMediaId"
              variant="text"
              color="error"
              prepend-icon="mdi-close"
              @click="removeBrandingLogo"
            >
              Remove Logo
            </v-btn>
          </div>
        </div>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Brand colors"
      description="Reusable colors for report accents and audience themes."
      icon="mdi-palette-outline"
    >
      <div class="branding-color-grid">
        <label class="branding-color-field">
          <span>Primary color</span>
          <div>
            <input
              type="color"
              :value="librarySettings!.branding.primaryColor"
              aria-label="Choose primary brand color"
              @input="setBrandingColor('primaryColor', $event)"
            />
            <v-text-field
              v-model="librarySettings!.branding.primaryColor"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
          <small>Headings and primary accents</small>
        </label>
        <label class="branding-color-field">
          <span>Secondary color</span>
          <div>
            <input
              type="color"
              :value="librarySettings!.branding.secondaryColor"
              aria-label="Choose secondary brand color"
              @input="setBrandingColor('secondaryColor', $event)"
            />
            <v-text-field
              v-model="librarySettings!.branding.secondaryColor"
              variant="outlined"
              density="compact"
              hide-details
            />
          </div>
          <small>Highlights and supporting accents</small>
        </label>
      </div>
    </SettingsPanel>

    <SettingsPanel
      title="Preview"
      description="A simplified example of how the identity appears on generated documents."
      icon="mdi-file-eye-outline"
    >
      <div
        class="branding-document-preview"
        :style="{
          '--preview-primary': librarySettings!.branding.primaryColor,
          '--preview-secondary': librarySettings!.branding.secondaryColor,
        }"
      >
        <header>
          <span class="branding-preview-logo">
            <img v-if="brandingLogoPreviewUrl" :src="brandingLogoPreviewUrl" alt="" />
            <v-icon v-else icon="mdi-church-outline" size="22" />
          </span>
          <div>
            <small>Worship Planning Report</small>
            <strong>{{ librarySettings!.branding.churchName || 'Your Church Name' }}</strong>
          </div>
        </header>
        <div class="branding-preview-rule" />
        <section>
          <span />
          <span />
          <span />
        </section>
      </div>
    </SettingsPanel>

    <MediaPickerDialog
      v-model="brandingLogoPickerOpen"
      purpose="logo"
      @select="selectBrandingLogo"
    />
  </div>
</template>

<style scoped>
.branding-name-field {
  max-width: 560px;
}
.branding-logo-layout {
  display: grid;
  max-width: 760px;
  grid-template-columns: 220px minmax(0, 1fr);
  align-items: center;
  gap: 22px;
}
.branding-logo-preview {
  display: flex;
  min-height: 132px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  overflow: hidden;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.18);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.3);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.branding-logo-preview img {
  width: 100%;
  height: 104px;
  object-fit: contain;
}
.branding-logo-preview span {
  font-size: 0.68rem;
}
.branding-logo-copy strong {
  font-size: 0.79rem;
}
.branding-logo-copy p {
  max-width: 470px;
  margin: 5px 0 14px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.71rem;
  line-height: 1.5;
}
.branding-logo-copy > div {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.branding-color-grid {
  display: grid;
  max-width: 620px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.branding-color-field > span {
  display: block;
  margin-bottom: 7px;
  font-size: 0.73rem;
  font-weight: 700;
}
.branding-color-field > div {
  display: grid;
  grid-template-columns: 45px minmax(0, 1fr);
  gap: 8px;
}
.branding-color-field input {
  width: 45px;
  height: 40px;
  padding: 3px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.branding-color-field small {
  display: block;
  margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.68rem;
}
.branding-document-preview {
  max-width: 620px;
  padding: 22px 24px 25px;
  overflow: hidden;
  border: 1px solid #dfe3e8;
  border-radius: 10px;
  background: #ffffff;
  color: #1f2937;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
}
.branding-document-preview header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.branding-preview-logo {
  display: grid;
  width: 45px;
  height: 45px;
  place-items: center;
  overflow: hidden;
  border-radius: 9px;
  background: color-mix(in srgb, var(--preview-primary) 12%, transparent);
  color: var(--preview-primary);
}
.branding-preview-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.branding-document-preview header small,
.branding-document-preview header strong {
  display: block;
}
.branding-document-preview header small {
  color: #667085;
  font-size: 0.64rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.branding-document-preview header strong {
  margin-top: 2px;
  color: var(--preview-primary);
  font-size: 0.9rem;
}
.branding-preview-rule {
  height: 3px;
  margin: 17px 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--preview-primary), var(--preview-secondary));
}
.branding-document-preview section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.branding-document-preview section span {
  width: 86%;
  height: 7px;
  border-radius: 999px;
  background: #e5e9ef;
}
.branding-document-preview section span:nth-child(2) {
  width: 68%;
}
.branding-document-preview section span:nth-child(3) {
  width: 76%;
}
@media (max-width: 700px) {
  .branding-logo-layout,
  .branding-color-grid {
    grid-template-columns: 1fr;
  }
  .branding-logo-preview {
    max-width: 320px;
  }
}
</style>
