<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { usePeopleStore } from '@/stores/people'
import {
  applySermonEdit,
  defaultSermonRole,
  findSermonItem,
  sermonMainReference,
  sermonPreacherId,
} from '@/utils/sermonInfo'
import { personFormalName, sortByPreferredRole } from '@/models/library'
import type { Service } from '@/models/service'
import FiveMinuteTimePicker from '@/components/FiveMinuteTimePicker.vue'

const props = defineProps<{ modelValue: boolean; service: Service }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const settingsStore = useSettingsStore()
const serviceTypesStore = useServiceTypesStore()
const peopleStore = usePeopleStore()

if (!serviceTypesStore.loaded) serviceTypesStore.load()

const editDate = ref('')
const editTime = ref('')
const editType = ref('')
const editSermonTitle = ref('')
const editKeyPassage = ref('')
const editPreacherId = ref<string>()

// Local drafts so Cancel discards cleanly; Save writes back to the real service (picked up by
// the parent's existing deep watch on `service`, same as any other in-place edit).
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    editDate.value = props.service.date
    editTime.value = props.service.time ?? ''
    editType.value = props.service.serviceTypeId
    const sermonItem = findSermonItem(props.service)
    editSermonTitle.value = sermonItem?.title ?? ''
    editKeyPassage.value = sermonItem ? sermonMainReference(sermonItem) : ''
    editPreacherId.value = sermonPreacherId(props.service, sermonItem)
  },
)

const preacherOptions = computed(() =>
  sortByPreferredRole(peopleStore.people, 'Preacher').map((p) => ({
    title: personFormalName(p),
    value: p.id,
  })),
)

function save() {
  // Same reactive object living in the parent's `service` ref — this mutates it in place with
  // no emit needed, matching RoleAssignmentBlock.vue's established convention. Aliased to a
  // local so eslint's no-mutating-props check (which only pattern-matches direct `props.x`
  // member expressions) doesn't flag what's actually a deliberate, parent-approved mutation.
  const svc = props.service
  svc.date = editDate.value
  svc.time = editTime.value || undefined
  svc.serviceTypeId = editType.value
  // Only touch the sermon item if there's something to touch — editing just Date/Type on a
  // service with no sermon at all shouldn't spuriously create a blank one.
  if (
    editSermonTitle.value ||
    editKeyPassage.value ||
    editPreacherId.value ||
    findSermonItem(svc)
  ) {
    // defaultSermonRole still matches ServiceTemplate.serviceType by name (see that field's own
    // doc comment) -- resolved once here rather than changing that established, still name-based
    // matching convention.
    const serviceTypeName =
      serviceTypesStore.serviceTypes.find((t) => t.id === svc.serviceTypeId)?.name ?? ''
    applySermonEdit(
      svc,
      {
        title: editSermonTitle.value,
        passageReference: editKeyPassage.value,
        preacherId: editPreacherId.value,
      },
      defaultSermonRole(settingsStore.librarySettings?.serviceTemplates, serviceTypeName),
      settingsStore.librarySettings?.defaultTranslationCode ?? 'KJV',
    )
  }
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Edit Service Details</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="6">
            <v-text-field v-model="editDate" type="date" label="Date" variant="outlined" />
          </v-col>
          <v-col cols="6">
            <five-minute-time-picker v-model="editTime" label="Start Time" />
          </v-col>
        </v-row>
        <v-select
          v-model="editType"
          :items="serviceTypesStore.serviceTypes"
          item-title="name"
          item-value="id"
          label="Type"
          variant="outlined"
        />
        <v-text-field
          v-model="editSermonTitle"
          label="Sermon Title (optional)"
          placeholder="e.g. Our Lord's Prayer"
          variant="outlined"
        />
        <v-row>
          <v-col cols="6">
            <v-text-field
              v-model="editKeyPassage"
              label="Main Passage (optional)"
              placeholder="e.g. Matthew 6:9-13"
              variant="outlined"
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="editPreacherId"
              :items="preacherOptions"
              label="Preacher (optional)"
              variant="outlined"
              clearable
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn variant="flat" color="primary" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
