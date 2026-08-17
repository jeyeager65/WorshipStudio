<script setup lang="ts">
import { computed, onMounted, reactive, toRaw, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useRoleGroupsStore } from '@/stores/roleGroups'
import { useRolesStore } from '@/stores/roles'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { BulletinSettings } from '@/models/settings'
import { roleOptionsFor } from '@/utils/roleOptions'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const settingsStore = useSettingsStore()
const roleGroupsStore = useRoleGroupsStore()
const rolesStore = useRolesStore()

onMounted(() => {
  roleGroupsStore.load()
  rolesStore.load()
})

// Local draft so Cancel discards cleanly — same convention as ServiceDetailsDialog.vue. Populated
// fresh from the store every time the dialog opens rather than tracking it continuously, since
// these fields only matter while the dialog is actually open.
const draft = reactive<BulletinSettings>({
  page1: {
    title: '',
    footer: { title: '', enabled: false },
  },
  page2: {
    enabled: false,
    title: '',
    footer: { title: '', enabled: false },
    announcements: { enabled: false },
    servingSchedule: { enabled: false, roleIds: [] },
  },
})
watch(
  () => props.modelValue,
  (open) => {
    if (!open || !settingsStore.librarySettings) return
    // Deep clone, not a shallow Object.assign of the store's own reactive nested objects —
    // otherwise editing draft.page1.title etc. would mutate the live store in real time, before
    // Save/Cancel, breaking this component's own "Cancel discards cleanly" contract (see above).
    Object.assign(draft, structuredClone(toRaw(settingsStore.librarySettings.bulletin)))
  },
)

// The bulletin's serving schedule picks individual roles (e.g. "Nursery", "Sound Booth"), not
// whole categories — grouped by category so roles from different groups stay distinguishable.
const bulletinRoleOptions = computed(() =>
  roleOptionsFor(rolesStore.roles, roleGroupsStore.roleGroups),
)

async function save() {
  if (!settingsStore.librarySettings) return
  // A real deep clone, not a shallow `{ ...draft }` — now that page1/page2/footer/etc. are
  // nested objects, a shallow spread would leave the stored settings holding live references
  // into this dialog's own reactive draft, aliasing the two the next time the dialog reopens.
  settingsStore.librarySettings.bulletin = structuredClone(toRaw(draft))
  await settingsStore.save()
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Bulletin Settings</v-card-title>
      <v-card-text>
        <SettingsPanel
          title="Page titles"
          description="Shown at the top of each half of the printed bulletin — your church's own naming."
          icon="mdi-format-title"
        >
          <v-text-field
            v-model="draft.page1.title"
            label="Order of Worship page title"
            variant="outlined"
            density="compact"
            hide-details
            class="mb-3"
          />
          <v-text-field
            v-model="draft.page2.title"
            label="Announcements page title"
            variant="outlined"
            density="compact"
            hide-details
          />
        </SettingsPanel>

        <SettingsPanel
          title="Order of Worship footer"
          description="A short quote or reflection at the bottom of the front page, entered fresh each week when generating the bulletin."
          icon="mdi-format-quote-close"
        >
          <v-switch
            v-model="draft.page1.footer.enabled"
            label="Show this footer"
            color="primary"
            density="compact"
            hide-details
            class="mb-3"
          />
          <v-text-field
            v-model="draft.page1.footer.title"
            label="Footer title"
            variant="outlined"
            density="compact"
            hide-details
            :disabled="!draft.page1.footer.enabled"
          />
        </SettingsPanel>

        <SettingsPanel
          title="Announcements page"
          description="Turn the whole second page, and each of its sections, on or off."
          icon="mdi-newspaper-variant-outline"
        >
          <v-switch
            v-model="draft.page2.enabled"
            label="Include this page in the bulletin export"
            color="primary"
            density="compact"
            hide-details
            class="mb-3"
          />
          <template v-if="draft.page2.enabled">
            <v-switch
              v-model="draft.page2.announcements.enabled"
              label="Show upcoming events and announcements"
              color="primary"
              density="compact"
              hide-details
              class="mb-3"
            />
            <v-switch
              v-model="draft.page2.servingSchedule.enabled"
              label="Show this week / next week serving schedule"
              color="primary"
              density="compact"
              hide-details
              class="mb-2"
            />
            <v-select
              v-if="draft.page2.servingSchedule.enabled"
              v-model="draft.page2.servingSchedule.roleIds"
              :items="bulletinRoleOptions"
              label="Roles to show as columns"
              variant="outlined"
              density="compact"
              multiple
              chips
              closable-chips
              hide-details
              class="mb-3"
            />
            <v-switch
              v-model="draft.page2.footer.enabled"
              label="Show a footer quote on this page"
              color="primary"
              density="compact"
              hide-details
              class="mb-3"
            />
            <v-text-field
              v-if="draft.page2.footer.enabled"
              v-model="draft.page2.footer.title"
              label="Footer title"
              variant="outlined"
              density="compact"
              hide-details
            />
          </template>
        </SettingsPanel>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn variant="flat" color="primary" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
