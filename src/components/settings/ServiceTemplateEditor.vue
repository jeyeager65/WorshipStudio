<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { ServiceTemplate, ServiceTemplateItem } from '@/models/service'
import type { RoleGroup } from '@/models/settings'

const props = defineProps<{ modelValue: ServiceTemplate[]; roleGroups: RoleGroup[]; serviceTypes: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [ServiceTemplate[]] }>()
const confirmDialog = useConfirmDialogStore()

const KIND_OPTIONS: { title: string; value: ServiceTemplateItem['kind'] }[] = [
  { title: 'Bulletin Note', value: 'bulletin-note' },
  { title: 'Sermon', value: 'sermon' },
  { title: 'Song', value: 'song' },
  { title: 'Scripture', value: 'scripture' },
  { title: 'Slide', value: 'slide' },
  { title: 'Media', value: 'media' },
  { title: 'Other', value: 'other' },
  { title: 'Role Only', value: 'role-only' },
]

interface RoleOption {
  type?: 'subheader'
  title: string
  value?: string
}
const roleOptions = computed<RoleOption[]>(() => {
  const items: RoleOption[] = []
  for (const group of props.roleGroups) {
    if (!group.roles.length) continue
    items.push({ type: 'subheader', title: group.name })
    for (const role of group.roles) items.push({ title: role, value: role })
  }
  return items
})

const templateNameToAdd = ref('')

function addTemplate() {
  const name = templateNameToAdd.value.trim()
  if (!name || props.modelValue.some((template) => template.serviceType.toLowerCase() === name.toLowerCase())) return
  emit('update:modelValue', [...props.modelValue, { serviceType: name, defaultForServiceTypes: [], items: [] }])
  templateNameToAdd.value = ''
}

function effectiveDefaultTypes(template: ServiceTemplate): string[] {
  if (template.defaultForServiceTypes !== undefined) return template.defaultForServiceTypes
  return props.serviceTypes.includes(template.serviceType) ? [template.serviceType] : []
}

function setDefaultTypes(templateIndex: number, serviceTypes: string[]) {
  const selected = new Set(serviceTypes)
  const templates = props.modelValue.map((template, index) => ({
    ...template,
    defaultForServiceTypes:
      index === templateIndex ? [...selected] : effectiveDefaultTypes(template).filter((type) => !selected.has(type)),
  }))
  emit('update:modelValue', templates)
}

async function removeTemplate(index: number) {
  const template = props.modelValue[index]
  if (!template) return
  if (!(await confirmDialog.confirm(`Remove the "${template.serviceType}" service template?`, 'Remove'))) return
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}

function setItems(templateIndex: number, items: ServiceTemplateItem[]) {
  const template = props.modelValue[templateIndex]
  if (!template) return
  const templates = [...props.modelValue]
  templates[templateIndex] = { ...template, items }
  emit('update:modelValue', templates)
}

function setItem(templateIndex: number, itemIndex: number, patch: Partial<ServiceTemplateItem>) {
  const template = props.modelValue[templateIndex]
  const item = template?.items[itemIndex]
  if (!template || !item) return
  const items = [...template.items]
  items[itemIndex] = { ...item, ...patch } as ServiceTemplateItem
  setItems(templateIndex, items)
}

function addItem(templateIndex: number) {
  const template = props.modelValue[templateIndex]
  if (!template) return
  setItems(templateIndex, [...template.items, { id: `template-item-${crypto.randomUUID()}`, kind: 'song', label: '' }])
}

async function removeItem(templateIndex: number, itemIndex: number) {
  const template = props.modelValue[templateIndex]
  const item = template?.items[itemIndex]
  if (!template || !item) return
  if (!(await confirmDialog.confirm(`Remove "${item.label || 'this item'}" from the template?`, 'Remove'))) return
  setItems(
    templateIndex,
    template.items.filter((_, i) => i !== itemIndex),
  )
}
</script>

<template>
  <div>
    <v-card v-for="(template, templateIndex) in modelValue" :key="template.serviceType" variant="outlined" rounded="lg" class="pa-3 mb-3">
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="text-subtitle-2 font-weight-bold">{{ template.serviceType }}</span>
        <v-btn icon="mdi-delete-outline" variant="text" size="small" @click="removeTemplate(templateIndex)" />
      </div>

      <v-select
        :model-value="effectiveDefaultTypes(template)"
        :items="serviceTypes"
        label="Default for Service Types"
        variant="outlined"
        density="compact"
        multiple
        chips
        closable-chips
        hide-details
        class="mb-3"
        @update:model-value="(types: string[]) => setDefaultTypes(templateIndex, types)"
      />

      <VueDraggable
        :model-value="template.items"
        handle=".drag-handle"
        :animation="150"
        class="d-flex flex-column ga-2 mb-2"
        @update:model-value="(items: ServiceTemplateItem[]) => setItems(templateIndex, items)"
      >
        <v-card v-for="(item, itemIndex) in template.items" :key="item.id" variant="outlined" rounded="lg" class="pa-2">
          <div class="d-flex align-center ga-2 mb-2">
            <v-icon icon="mdi-drag-vertical" class="drag-handle" size="small" style="cursor: grab" />
            <v-select
              :model-value="item.kind"
              :items="KIND_OPTIONS"
              label="Kind"
              variant="outlined"
              density="compact"
              hide-details
              style="max-width: 180px"
              @update:model-value="(kind: ServiceTemplateItem['kind']) => setItem(templateIndex, itemIndex, { kind })"
            />
            <v-text-field
              :model-value="item.label"
              label="Label"
              variant="outlined"
              density="compact"
              hide-details
              class="flex-grow-1"
              @update:model-value="(label: string) => setItem(templateIndex, itemIndex, { label })"
            />
            <v-btn icon="mdi-close" variant="text" size="small" @click="removeItem(templateIndex, itemIndex)" />
          </div>

          <v-textarea
            v-if="item.kind === 'bulletin-note'"
            :model-value="item.note"
            label="Note (optional)"
            variant="outlined"
            density="compact"
            rows="2"
            auto-grow
            hide-details
            class="mb-2"
            @update:model-value="(note: string) => setItem(templateIndex, itemIndex, { note: note || undefined })"
          />

          <div class="d-flex align-center ga-2">
            <v-select
              :model-value="item.role"
              :items="roleOptions"
              :label="item.kind === 'role-only' ? 'Role' : 'Role (optional)'"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              class="flex-grow-1"
              @update:model-value="(role: string | undefined) => setItem(templateIndex, itemIndex, { role })"
            />
            <v-text-field
              v-if="item.kind === 'role-only'"
              :model-value="item.count ?? 1"
              type="number"
              min="1"
              label="Count"
              variant="outlined"
              density="compact"
              hide-details
              style="max-width: 100px"
              @update:model-value="(value: string) => setItem(templateIndex, itemIndex, { count: Math.max(1, Number(value)) })"
            />
          </div>
        </v-card>
      </VueDraggable>
      <p v-if="template.items.length === 0" class="text-medium-emphasis text-body-2 mb-2">No items yet.</p>

      <v-btn variant="flat" color="primary" size="small" prepend-icon="mdi-plus" @click="addItem(templateIndex)">
        Add Item
      </v-btn>
    </v-card>
    <p v-if="modelValue.length === 0" class="text-medium-emphasis text-body-2 mb-3">No templates yet.</p>

    <div class="d-flex align-center ga-2" style="max-width: 480px">
      <v-text-field
        v-model="templateNameToAdd"
        label="New Template Name"
        placeholder="e.g. Sunday Worship"
        variant="outlined"
        density="compact"
        hide-details
        @keydown.enter="addTemplate"
      />
      <v-btn variant="flat" color="primary" prepend-icon="mdi-plus" :disabled="!templateNameToAdd.trim()" @click="addTemplate">
        Add Template
      </v-btn>
    </div>
  </div>
</template>
