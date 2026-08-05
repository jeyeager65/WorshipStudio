<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTheme } from 'vuetify'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getAdapter } from '@/adapters'
import { diagnosticBundleFilename, formatDiagnosticSummary } from '@/utils/diagnostics'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import logoDark from '@/assets/logo-dark.png'
import logoLight from '@/assets/logo-light.png'

const theme = useTheme()
const aboutLogo = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))

const appVersion = ref('')
void getVersion()
  .then((version) => (appVersion.value = version))
  .catch(() => (appVersion.value = 'Development build'))

const projectLinks = [
  {
    label: 'Source Code',
    description: 'View the Worship Studio source on GitHub',
    icon: 'mdi-github',
    url: 'https://github.com/jeyeager65/WorshipStudio',
  },
  {
    label: 'Report an Issue',
    description: 'Report a bug or request a feature',
    icon: 'mdi-bug-outline',
    url: 'https://github.com/jeyeager65/WorshipStudio/issues',
  },
  {
    label: 'Releases',
    description: 'See release notes and available downloads',
    icon: 'mdi-tag-outline',
    url: 'https://github.com/jeyeager65/WorshipStudio/releases',
  },
] as const

async function openProjectLink(url: string) {
  if (getAdapter().kind === 'tauri') await openUrl(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

const diagnosticAction = ref<'logs' | 'copy' | 'export'>()
const diagnosticStatus = ref('')
const diagnosticError = ref('')

async function openDiagnosticLogs() {
  const openLogsFolder = getAdapter().diagnostics.openLogsFolder
  if (!openLogsFolder) return
  diagnosticAction.value = 'logs'
  diagnosticStatus.value = ''
  diagnosticError.value = ''
  try {
    await openLogsFolder()
    diagnosticStatus.value = 'Opened the Worship Studio logs folder.'
  } catch (error) {
    diagnosticError.value = error instanceof Error ? error.message : 'The logs folder could not be opened.'
  } finally {
    diagnosticAction.value = undefined
  }
}

async function copyDiagnosticSummary() {
  diagnosticAction.value = 'copy'
  diagnosticStatus.value = ''
  diagnosticError.value = ''
  try {
    const summary = await getAdapter().diagnostics.getSummary()
    await navigator.clipboard.writeText(formatDiagnosticSummary(summary))
    diagnosticStatus.value = 'Diagnostic summary copied. Review it before sharing.'
  } catch (error) {
    diagnosticError.value = error instanceof Error ? error.message : 'The diagnostic summary could not be copied.'
  } finally {
    diagnosticAction.value = undefined
  }
}

async function exportDiagnosticBundle() {
  diagnosticAction.value = 'export'
  diagnosticStatus.value = ''
  diagnosticError.value = ''
  try {
    const bundle = await getAdapter().diagnostics.createBundle()
    const result = await getAdapter().exports.saveFile({
      suggestedName: diagnosticBundleFilename(),
      mimeType: 'application/json',
      extensions: ['json'],
      bytes: new TextEncoder().encode(bundle),
    })
    if (result !== 'cancelled')
      diagnosticStatus.value = 'Diagnostic bundle saved. Review it before sharing.'
  } catch (error) {
    diagnosticError.value = error instanceof Error ? error.message : 'The diagnostic bundle could not be exported.'
  } finally {
    diagnosticAction.value = undefined
  }
}
</script>

<template>
  <div class="about-stack">
    <div class="about-card">
      <img :src="aboutLogo" alt="Worship Studio" class="about-logo" />
      <div class="about-version">Version {{ appVersion || '…' }}</div>
      <p class="about-description">
        Worship planning and presentation software built for calm, confident operation during a
        service.
      </p>

      <div class="about-links">
        <button
          v-for="link in projectLinks"
          :key="link.url"
          type="button"
          class="about-link"
          @click="openProjectLink(link.url)"
        >
          <span class="about-link-icon"><v-icon :icon="link.icon" size="20" /></span>
          <span class="about-link-copy">
            <strong>{{ link.label }}</strong>
            <small>{{ link.description }}</small>
          </span>
          <v-icon icon="mdi-open-in-new" size="16" class="about-link-arrow" />
        </button>
      </div>
    </div>

    <SettingsPanel
      title="Support & diagnostics"
      description="Collect technical details that can help investigate a problem."
      icon="mdi-lifebuoy"
    >
      <v-alert type="info" variant="tonal" density="compact" class="mb-4">
        Diagnostics exclude settings files, church content, people, credentials, authorization
        tokens, and device names. Log excerpts are size-limited and redacted.
      </v-alert>
      <div class="diagnostic-actions">
        <v-btn
          v-if="getAdapter().diagnostics.openLogsFolder"
          variant="outlined"
          prepend-icon="mdi-folder-text-outline"
          :loading="diagnosticAction === 'logs'"
          :disabled="!!diagnosticAction && diagnosticAction !== 'logs'"
          @click="openDiagnosticLogs"
        >
          Open Logs Folder
        </v-btn>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-content-copy"
          :loading="diagnosticAction === 'copy'"
          :disabled="!!diagnosticAction && diagnosticAction !== 'copy'"
          @click="copyDiagnosticSummary"
        >
          Copy Diagnostic Summary
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-package-down"
          :loading="diagnosticAction === 'export'"
          :disabled="!!diagnosticAction && diagnosticAction !== 'export'"
          @click="exportDiagnosticBundle"
        >
          Export Diagnostic Bundle
        </v-btn>
      </div>
      <v-alert v-if="diagnosticStatus" type="success" variant="tonal" density="compact" class="mt-4">
        {{ diagnosticStatus }}
      </v-alert>
      <v-alert v-if="diagnosticError" type="error" variant="tonal" density="compact" class="mt-4">
        {{ diagnosticError }}
      </v-alert>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.about-card {
  max-width: 600px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.72);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.12);
}
.about-stack {
  display: grid;
  max-width: 760px;
  gap: 18px;
}
.about-stack .about-card {
  max-width: none;
}
.diagnostic-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.about-logo {
  display: block;
  width: min(360px, calc(100% - 64px));
  height: auto;
  margin: 38px auto 14px;
}
.about-version {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: center;
  text-transform: uppercase;
}
.about-description {
  max-width: 460px;
  margin: 16px auto 30px;
  padding: 0 24px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.8rem;
  line-height: 1.55;
  text-align: center;
}
.about-links {
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.about-link {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 18px;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background-color var(--ws-transition-fast);
}
.about-link:last-child {
  border-bottom: 0;
}
.about-link:hover,
.about-link:focus-visible {
  background: rgba(var(--v-theme-primary), 0.09);
  outline: none;
}
.about-link:focus-visible {
  box-shadow: inset 3px 0 rgb(var(--v-theme-primary));
}
.about-link-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.about-link-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.about-link-copy strong {
  font-size: 0.78rem;
  font-weight: 650;
}
.about-link-copy small {
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.68rem;
}
.about-link-arrow {
  color: rgba(var(--v-theme-on-surface), 0.38);
}
</style>
