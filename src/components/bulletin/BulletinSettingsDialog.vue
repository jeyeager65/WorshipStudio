<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { BulletinSettings } from '@/models/settings'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const settingsStore = useSettingsStore()

// Local draft so Cancel discards cleanly — same convention as ServiceDetailsDialog.vue. Populated
// fresh from the store every time the dialog opens rather than tracking it continuously, since
// these fields only matter while the dialog is actually open.
const draft = reactive<BulletinSettings>({
  page1Title: '',
  page2Title: '',
  page1FooterTitle: '',
  page1FooterEnabled: false,
  page2FooterTitle: '',
  page2FooterEnabled: false,
  page2Enabled: false,
  showAnnouncements: false,
  showServingSchedule: false,
  servingScheduleRoles: [],
})
watch(
  () => props.modelValue,
  (open) => {
    if (!open || !settingsStore.librarySettings) return
    Object.assign(draft, settingsStore.librarySettings.bulletin)
  },
)

// The bulletin's serving schedule picks individual roles (e.g. "Nursery", "Sound Booth"), not
// whole categories — flattened and deduped across every role group, category-labeled so two
// same-named roles in different groups (unlikely, but not prevented elsewhere) stay distinguishable.
const bulletinRoleOptions = computed(() => {
  const seen = new Set<string>()
  const options: { title: string; value: string }[] = []
  for (const group of settingsStore.librarySettings?.roleGroups ?? []) {
    for (const role of group.roles) {
      if (seen.has(role)) continue
      seen.add(role)
      options.push({ title: `${group.name} - ${role}`, value: role })
    }
  }
  return options
})

async function save() {
  if (!settingsStore.librarySettings) return
  settingsStore.librarySettings.bulletin = { ...draft }
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
            v-model="draft.page1Title"
            label="Order of Worship page title"
            variant="outlined"
            density="compact"
            hide-details
            class="mb-3"
          />
          <v-text-field
            v-model="draft.page2Title"
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
            v-model="draft.page1FooterEnabled"
            label="Show this footer"
            color="primary"
            density="compact"
            hide-details
            class="mb-3"
          />
          <v-text-field
            v-model="draft.page1FooterTitle"
            label="Footer title"
            variant="outlined"
            density="compact"
            hide-details
            :disabled="!draft.page1FooterEnabled"
          />
        </SettingsPanel>

        <SettingsPanel
          title="Announcements page"
          description="Turn the whole second page, and each of its sections, on or off."
          icon="mdi-newspaper-variant-outline"
        >
          <v-switch
            v-model="draft.page2Enabled"
            label="Include this page in the bulletin export"
            color="primary"
            density="compact"
            hide-details
            class="mb-3"
          />
          <template v-if="draft.page2Enabled">
            <v-switch
              v-model="draft.showAnnouncements"
              label="Show upcoming events and announcements"
              color="primary"
              density="compact"
              hide-details
              class="mb-3"
            />
            <v-switch
              v-model="draft.showServingSchedule"
              label="Show this week / next week serving schedule"
              color="primary"
              density="compact"
              hide-details
              class="mb-2"
            />
            <v-select
              v-if="draft.showServingSchedule"
              v-model="draft.servingScheduleRoles"
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
              v-model="draft.page2FooterEnabled"
              label="Show a footer quote on this page"
              color="primary"
              density="compact"
              hide-details
              class="mb-3"
            />
            <v-text-field
              v-if="draft.page2FooterEnabled"
              v-model="draft.page2FooterTitle"
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
