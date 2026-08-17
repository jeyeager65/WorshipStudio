<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { CanvaStatus } from '@/adapters/types'

const { libraryCredentials, machineSettings } = storeToRefs(useSettingsStore())
const { isDirty } = storeToRefs(useUnsavedChangesStore())
const confirmDialog = useConfirmDialogStore()

const canvaCallbackPort = computed<number | null>({
  get: () => machineSettings.value?.canvaCallbackPort ?? null,
  set: (port) => {
    if (machineSettings.value) machineSettings.value.canvaCallbackPort = port ?? undefined
  },
})
const canvaCallbackUrl = computed(() => {
  const port = canvaCallbackPort.value
  return port ? `http://127.0.0.1:${port}/canva/callback` : ''
})
// Duplicated from the parent shell's identical computed (needed there to gate saveSettings())
// rather than plumbed through props — it only reads the shared machineSettings store ref.
const canvaPortConflict = computed(
  () =>
    !!machineSettings.value?.remoteControlPort &&
    machineSettings.value.remoteControlPort === machineSettings.value.canvaCallbackPort,
)

const canvaStatus = ref<CanvaStatus>()
const canvaStatusLoading = ref(false)
const canvaActionError = ref('')
let canvaStatusTimer: ReturnType<typeof setInterval> | undefined
async function loadCanvaStatus() {
  const canva = getAdapter().canva
  if (!canva) return
  canvaStatusLoading.value = true
  try {
    canvaStatus.value = await canva.status()
  } catch (error) {
    canvaActionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    canvaStatusLoading.value = false
  }
}
async function connectThisComputerToCanva() {
  const canva = getAdapter().canva
  if (!canva || isDirty.value) return
  canvaActionError.value = ''
  try {
    await canva.connect()
    canvaStatus.value = await canva.status()
    if (canvaStatusTimer) clearInterval(canvaStatusTimer)
    canvaStatusTimer = setInterval(async () => {
      try {
        canvaStatus.value = await canva.status()
        if (canvaStatus.value.connected || canvaStatus.value.error) {
          if (canvaStatusTimer) clearInterval(canvaStatusTimer)
          canvaStatusTimer = undefined
        }
      } catch (error) {
        canvaActionError.value = error instanceof Error ? error.message : String(error)
        if (canvaStatusTimer) clearInterval(canvaStatusTimer)
        canvaStatusTimer = undefined
      }
    }, 1000)
  } catch (error) {
    canvaActionError.value = error instanceof Error ? error.message : String(error)
  }
}
async function disconnectThisComputerFromCanva() {
  const canva = getAdapter().canva
  if (!canva) return
  if (
    !(await confirmDialog.confirm(
      'Disconnect this computer from Canva? The church integration credentials will remain available to other computers.',
      'Disconnect',
    ))
  )
    return
  canvaActionError.value = ''
  if (canvaStatusTimer) clearInterval(canvaStatusTimer)
  canvaStatusTimer = undefined
  try {
    await canva.disconnect()
    await loadCanvaStatus()
  } catch (error) {
    canvaActionError.value = error instanceof Error ? error.message : String(error)
  }
}

onUnmounted(() => {
  if (canvaStatusTimer) clearInterval(canvaStatusTimer)
})

// Called by the parent's saveSettings() after store.save() — same timing as today's single
// shared onMounted/saveSettings, just routed through this component's own state instead.
defineExpose({ loadCanvaStatus })
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
    <SettingsPanel
      title="Church integration"
      description="One Canva integration is shared by every Worship Studio computer using this library."
      icon="mdi-connection"
    >
      <v-alert type="info" variant="tonal" density="compact" class="mb-4">
        Create one integration in a church-controlled Canva Developer account. People at this church
        use the same integration; they do not each create their own.
      </v-alert>
      <div class="canva-setup-steps mb-5">
        <div>
          <span>1</span>
          <p>
            <strong>Create the integration</strong
            ><small>Copy its client ID and generate its client secret.</small>
          </p>
        </div>
        <div>
          <span>2</span>
          <p>
            <strong>Register this callback URL</strong><code>{{ canvaCallbackUrl }}</code>
          </p>
        </div>
        <div>
          <span>3</span>
          <p>
            <strong>Enable the required scopes</strong>
            <small
              ><code>design:meta:read</code>, <code>design:content:read</code>, and
              <code>design:content:write</code></small
            >
          </p>
        </div>
      </div>
      <v-text-field
        v-model="libraryCredentials!.canvaIntegration.clientId"
        label="Canva client ID"
        variant="outlined"
        density="compact"
        autocomplete="off"
        class="settings-form-field mb-2"
        hint="Shared through the church library."
        persistent-hint
      />
      <v-text-field
        v-model="libraryCredentials!.canvaIntegration.clientSecret"
        label="Canva client secret"
        type="password"
        variant="outlined"
        density="compact"
        autocomplete="off"
        class="settings-form-field"
        hint="Shared privately with computers that can access this church library. Never included in logs or exports."
        persistent-hint
      />
    </SettingsPanel>

    <SettingsPanel
      title="Callback address"
      description="Canva requires an exact registered address, so this port stays fixed instead of following Remote Control."
      icon="mdi-callback"
    >
      <div class="remote-setting-row canva-callback-setting">
        <div class="remote-setting-copy">
          <strong>This installation’s callback</strong>
          <span>
            Installed copies default to 47823 and portable copies to 47824. Change it only for a
            conflict, then register the new URL in Canva.
          </span>
          <code>{{ canvaCallbackUrl }}</code>
        </div>
        <v-number-input
          v-model="canvaCallbackPort"
          label="Callback port"
          variant="outlined"
          density="compact"
          control-variant="stacked"
          :min="1024"
          :max="65535"
          :error="canvaPortConflict"
          :error-messages="
            canvaPortConflict ? 'Use a different port from Remote Control.' : undefined
          "
        />
      </div>
      <v-alert
        v-if="canvaStatus?.error"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-4"
      >
        {{ canvaStatus.error }}
      </v-alert>
    </SettingsPanel>

    <SettingsPanel
      title="This computer"
      description="The church integration is shared, but each computer authorizes the Canva account it will use."
      icon="mdi-laptop-account"
    >
      <div class="canva-connection-status">
        <span class="canva-connection-icon">
          <v-icon
            :icon="canvaStatus?.connected ? 'mdi-check-circle-outline' : 'mdi-link-off'"
            size="22"
          />
        </span>
        <div>
          <strong>{{ canvaStatus?.connected ? 'Connected to Canva' : 'Not connected' }}</strong>
          <small>
            {{
              canvaStatus?.connected
                ? 'OAuth access and refresh tokens are stored only for this installation.'
                : 'Save the church integration first, then authorize this computer in your browser.'
            }}
          </small>
        </div>
        <v-btn
          v-if="canvaStatus?.connected"
          variant="outlined"
          color="error"
          :loading="canvaStatusLoading"
          @click="disconnectThisComputerFromCanva"
        >
          Disconnect This Computer
        </v-btn>
        <v-btn
          v-else
          variant="flat"
          color="primary"
          prepend-icon="mdi-open-in-new"
          :disabled="
            isDirty ||
            !libraryCredentials!.canvaIntegration.clientId.trim() ||
            !libraryCredentials!.canvaIntegration.clientSecret.trim() ||
            canvaPortConflict
          "
          :loading="canvaStatusLoading || canvaStatus?.connecting"
          @click="connectThisComputerToCanva"
        >
          Connect This Computer
        </v-btn>
      </div>
      <v-alert
        v-if="isDirty && !canvaStatus?.connected"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-4"
      >
        Save these settings before connecting this computer.
      </v-alert>
      <v-alert v-if="canvaActionError" type="error" variant="tonal" density="compact" class="mt-4">
        {{ canvaActionError }}
      </v-alert>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.settings-form-field {
  max-width: 520px;
}
.canva-setup-steps {
  display: grid;
  gap: 10px;
  max-width: 760px;
}
.canva-setup-steps > div {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 9px;
  background: rgba(var(--v-theme-surface-variant), 0.2);
}
.canva-setup-steps > div > span,
.canva-connection-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.13);
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 800;
}
.canva-setup-steps p {
  display: grid;
  gap: 3px;
  margin: 0;
}
.canva-setup-steps small,
.canva-connection-status small {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.4;
}
.canva-setup-steps code,
.canva-callback-setting code {
  width: fit-content;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), 0.82);
}
.canva-callback-setting {
  max-width: 760px;
}
.canva-connection-status {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  max-width: 760px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 10px;
}
.canva-connection-status > div {
  display: grid;
  gap: 2px;
}
.remote-setting-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(230px, 280px);
  align-items: center;
  gap: 24px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.remote-setting-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.remote-setting-copy strong {
  display: block;
  font-size: 0.78rem;
}
.remote-setting-copy span {
  display: block;
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  line-height: 1.45;
}
@media (max-width: 700px) {
  .remote-setting-row {
    grid-template-columns: 1fr;
    gap: 9px;
  }
  .canva-connection-status {
    grid-template-columns: 40px minmax(0, 1fr);
  }
  .canva-connection-status .v-btn {
    grid-column: 1 / -1;
  }
}
</style>
