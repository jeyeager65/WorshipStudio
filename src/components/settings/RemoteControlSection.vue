<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { usePeopleStore } from '@/stores/people'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { personDisplayName } from '@/models/library'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { RemoteDevice } from '@/adapters/types'

const { machineSettings } = storeToRefs(useSettingsStore())
const peopleStore = usePeopleStore()
const confirmDialog = useConfirmDialogStore()

// Remote Control devices are machine-local, but ownership points at the synced people library.
const remoteDevices = ref<RemoteDevice[]>([])
const remoteServerInfo = ref<{ hostname?: string; lanIp?: string; port: number }>()
const remoteHostnameOverride = computed<string>({
  get: () => machineSettings.value?.remoteControlHostname ?? '',
  set: (hostname) => {
    if (machineSettings.value)
      machineSettings.value.remoteControlHostname = hostname.trim() || undefined
  },
})
const remotePortOverride = computed<number | null>({
  get: () => machineSettings.value?.remoteControlPort ?? null,
  set: (port) => {
    if (machineSettings.value) machineSettings.value.remoteControlPort = port ?? undefined
  },
})
async function loadRemoteDevices() {
  try {
    remoteDevices.value = (await getAdapter().remote?.listDevices()) ?? []
    remoteServerInfo.value = await getAdapter().remote?.getServerInfo()
  } catch (e) {
    console.error('Failed to load remote devices:', e)
    remoteDevices.value = []
  }
}

const accessLevelOptions: { title: string; value: RemoteDevice['accessLevel'] }[] = [
  { title: 'View Only', value: 'view-only' },
  { title: 'Full Control', value: 'full-control' },
]
function accessLevelLabel(level: RemoteDevice['accessLevel']): string {
  return accessLevelOptions.find((o) => o.value === level)?.title ?? level
}

const provisionDialogOpen = ref(false)
const newDevicePersonId = ref('')
const newDeviceName = ref('')
const newDeviceAccessLevel = ref<RemoteDevice['accessLevel']>('view-only')
const provisioning = ref(false)
const provisionResult = ref<{ qrDataUrl: string; pairingUrl: string }>()
const repairingDeviceId = ref<string>()
const remotePersonOptions = computed(() =>
  [...peopleStore.people]
    .sort((a, b) => personDisplayName(a).localeCompare(personDisplayName(b)))
    .map((person) => ({ title: personDisplayName(person), value: person.id })),
)

function remoteDeviceOwner(device: RemoteDevice): string {
  const owner = peopleStore.people.find((person) => person.id === device.personId)
  return owner ? personDisplayName(owner) : 'Unassigned legacy device'
}

function openProvisionDialog(personId = '') {
  newDevicePersonId.value = personId
  newDeviceName.value = ''
  newDeviceAccessLevel.value = 'view-only'
  provisionResult.value = undefined
  provisionDialogOpen.value = true
}
async function provisionDevice() {
  if (!newDevicePersonId.value || !newDeviceName.value.trim() || provisioning.value) return
  provisioning.value = true
  try {
    provisionResult.value = await getAdapter().remote?.provisionDevice(
      newDevicePersonId.value,
      newDeviceName.value.trim(),
      newDeviceAccessLevel.value,
    )
    await loadRemoteDevices()
  } catch (e) {
    console.error('Failed to provision remote device:', e)
  } finally {
    provisioning.value = false
  }
}
async function repairRemoteDevice(device: RemoteDevice) {
  repairingDeviceId.value = device.id
  try {
    provisionResult.value = await getAdapter().remote?.repairDevice(device.id)
    newDeviceName.value = device.name
    newDevicePersonId.value = device.personId ?? ''
    provisionDialogOpen.value = true
  } catch (e) {
    console.error('Failed to re-pair remote device:', e)
  } finally {
    repairingDeviceId.value = undefined
  }
}
async function revokeRemoteDevice(device: RemoteDevice) {
  if (!(await confirmDialog.confirm(`Revoke access for "${device.name}"?`, 'Revoke'))) return
  await getAdapter().remote?.revokeDevice(device.id)
  await loadRemoteDevices()
}

// Unconditional (not `if (!peopleStore.loaded)`) — matches the original shared onMounted's own
// behavior. Other views (e.g. LandingView.vue) load this same store more cautiously since they
// only ever need a "good enough" snapshot, but Settings is where people get added/edited, so
// every visit here should reflect whatever is on disk right now, not an earlier visit's cache.
onMounted(async () => {
  await Promise.all([peopleStore.load(), loadRemoteDevices()])
})
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
  <SettingsPanel
    title="Connection"
    description="How phones and tablets find this Worship Studio installation on the local network."
    icon="mdi-lan-connect"
  >
    <div class="remote-connection-summary">
      <span class="remote-connection-summary-icon">
        <v-icon icon="mdi-access-point-network" size="20" />
      </span>
      <div>
        <span>Active address</span>
        <strong>
          {{ remoteServerInfo?.hostname ?? remoteServerInfo?.lanIp ?? 'Starting…' }}:{{
            remoteServerInfo?.port ?? '…'
          }}
        </strong>
        <small v-if="remoteServerInfo?.lanIp">
          Also available at {{ remoteServerInfo.lanIp }}:{{ remoteServerInfo.port }}
        </small>
      </div>
      <v-chip
        :color="remoteServerInfo ? 'success' : undefined"
        variant="tonal"
        size="small"
        :prepend-icon="remoteServerInfo ? 'mdi-check-circle-outline' : 'mdi-timer-sand'"
      >
        {{ remoteServerInfo ? 'Available' : 'Starting' }}
      </v-chip>
    </div>

    <div class="remote-connection-options">
      <div class="remote-setting-row">
        <div class="remote-setting-copy">
          <strong>Local hostname</strong>
          <span>
            Leave automatic for an installation-specific name. Use “worshipstudio” for the primary
            booth.
          </span>
        </div>
        <v-text-field
          v-model="remoteHostnameOverride"
          label="Hostname"
          placeholder="Automatic"
          suffix=".local"
          variant="outlined"
          density="comfortable"
          clearable
          maxlength="63"
          hide-details
        />
      </div>

      <div class="remote-setting-row">
        <div class="remote-setting-copy">
          <strong>Port</strong>
          <span>
            Automatic remembers an available port. Set a specific port only when required by the
            network.
          </span>
        </div>
        <v-number-input
          v-model="remotePortOverride"
          label="Port"
          placeholder="Automatic"
          variant="outlined"
          density="comfortable"
          control-variant="stacked"
          :min="1024"
          :max="65535"
          clearable
          hide-details
        />
      </div>
    </div>
  </SettingsPanel>

  <SettingsPanel
    title="Paired devices"
    description="Phones and tablets authorized to view or control the current presentation."
    icon="mdi-cellphone-link"
  >
    <template #action>
      <v-btn
        variant="flat"
        color="primary"
        prepend-icon="mdi-plus"
        :disabled="remotePersonOptions.length === 0"
        @click="openProvisionDialog()"
      >
        Pair a Device
      </v-btn>
    </template>
    <v-alert v-if="remoteServerInfo && !remoteServerInfo.lanIp" type="warning" variant="tonal" class="mb-4">
      Couldn't detect a network address for this computer — check that it's connected to the
      church's network, then reopen this screen.
    </v-alert>
    <v-alert
      v-if="remotePersonOptions.length === 0"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Add a person before pairing a Remote Control device.
    </v-alert>
    <v-list v-if="remoteDevices.length > 0" density="comfortable" class="settings-list">
      <v-list-item v-for="device in remoteDevices" :key="device.id" rounded="lg" class="mb-1" border>
        <template #prepend><v-icon icon="mdi-cellphone" class="mr-3" /></template>
        <v-list-item-title class="font-weight-bold">{{ device.name }}</v-list-item-title>
        <v-list-item-subtitle>
          {{ remoteDeviceOwner(device) }} · {{ accessLevelLabel(device.accessLevel) }}
        </v-list-item-subtitle>
        <template #append>
          <v-btn
            icon="mdi-qrcode-scan"
            variant="text"
            size="small"
            :loading="repairingDeviceId === device.id"
            :disabled="!device.personId"
            aria-label="Re-pair device"
            @click.stop="repairRemoteDevice(device)"
          />
          <v-btn
            icon="mdi-trash-can-outline"
            variant="text"
            size="small"
            color="error"
            @click.stop="revokeRemoteDevice(device)"
          />
        </template>
      </v-list-item>
    </v-list>
    <div v-else class="settings-empty">
      <v-icon icon="mdi-cellphone-off" size="28" />
      <span>No devices paired yet.</span>
    </div>
  </SettingsPanel>

  <v-dialog v-model="provisionDialogOpen" max-width="480">
    <v-card>
      <v-card-title>Pair a Device</v-card-title>
      <v-card-text>
        <template v-if="!provisionResult">
          <v-select
            v-model="newDevicePersonId"
            :items="remotePersonOptions"
            label="Person"
            placeholder="Choose the device owner"
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <v-text-field
            v-model="newDeviceName"
            label="Device Name"
            placeholder="e.g. iPhone or Booth Tablet"
            variant="outlined"
            density="comfortable"
            autofocus
            class="mb-2"
          />
          <v-select
            v-model="newDeviceAccessLevel"
            :items="accessLevelOptions"
            label="Access Level"
            variant="outlined"
            density="comfortable"
          />
          <div class="text-caption text-medium-emphasis mb-2">
            <div>
              <strong>View Only</strong> — mirrors the presentation screen, no controls.
            </div>
            <div>
              <strong>Full Control</strong> — mirror, Previous/Next, jump to any slide, and
              Start/Stop Presenting.
            </div>
          </div>
        </template>
        <template v-else>
          <div class="text-center mb-3">
            <img
              :src="provisionResult.qrDataUrl"
              alt="Pairing QR code"
              style="width: 220px; height: 220px"
            />
          </div>
          <p class="text-body-2 text-center mb-2">
            Scan this with "{{ newDeviceName }}"'s camera, or open this link on it directly:
          </p>
          <p class="text-caption text-medium-emphasis text-center" style="word-break: break-all">
            {{ provisionResult.pairingUrl }}
          </p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="!provisionResult">
          <v-btn variant="text" @click="provisionDialogOpen = false">Cancel</v-btn>
          <v-btn
            variant="flat"
            color="primary"
            :loading="provisioning"
            :disabled="!newDevicePersonId || !newDeviceName.trim()"
            @click="provisionDevice"
          >
            Generate QR Code
          </v-btn>
        </template>
        <v-btn v-else variant="flat" color="primary" @click="provisionDialogOpen = false">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  </div>
</template>

<style scoped>
.remote-connection-summary {
  display: grid;
  max-width: 700px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.045);
}
.remote-connection-summary-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.remote-connection-summary > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.remote-connection-summary span,
.remote-connection-summary small {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.65rem;
}
.remote-connection-summary strong {
  overflow: hidden;
  margin: 1px 0;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remote-connection-options {
  max-width: 700px;
  margin-top: 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
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
@media (max-width: 700px) {
  .remote-setting-row {
    grid-template-columns: 1fr;
    gap: 9px;
  }
  .remote-connection-summary {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .remote-connection-summary > .v-chip {
    display: none;
  }
}
</style>
