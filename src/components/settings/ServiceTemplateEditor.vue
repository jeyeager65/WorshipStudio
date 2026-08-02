<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { ServiceTemplate, ServiceTemplateItem } from '@/models/service'
import type { RoleGroup } from '@/models/settings'

const props = defineProps<{
  modelValue: ServiceTemplate[]
  roleGroups: RoleGroup[]
  serviceTypes: string[]
  standalone?: boolean
  initialSelectedIndex?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [ServiceTemplate[]] }>()
const confirmDialog = useConfirmDialogStore()

const KIND_OPTIONS: { title: string; value: ServiceTemplateItem['kind']; icon: string }[] = [
  { title: 'Song', value: 'song', icon: 'mdi-music-note-outline' },
  { title: 'Scripture', value: 'scripture', icon: 'mdi-book-cross' },
  { title: 'Sermon', value: 'sermon', icon: 'mdi-book-open-page-variant-outline' },
  { title: 'Bulletin Note', value: 'bulletin-note', icon: 'mdi-newspaper-variant-outline' },
  { title: 'Slide', value: 'slide', icon: 'mdi-presentation' },
  { title: 'Media', value: 'media', icon: 'mdi-image-outline' },
  { title: 'Other', value: 'other', icon: 'mdi-shape-outline' },
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

const selectedIndex = ref(props.initialSelectedIndex ?? 0)
const activeMode = ref<'order' | 'roles' | 'defaults'>('order')
const selectedOrderItemId = ref('')
const selectedRoleItemId = ref('')
const creatingTemplate = ref(false)
const templateNameToAdd = ref('')
const renamingTemplate = ref(false)
const templateNameDraft = ref('')

const selectedTemplate = computed(() => props.modelValue[selectedIndex.value])
const serviceOrderItems = computed(
  () => selectedTemplate.value?.items.filter((item) => item.kind !== 'role-only') ?? [],
)
const roleOnlyItems = computed(
  () => selectedTemplate.value?.items.filter((item) => item.kind === 'role-only') ?? [],
)
const selectedOrderItem = computed(() =>
  serviceOrderItems.value.find((item) => item.id === selectedOrderItemId.value),
)
const selectedRoleItem = computed(() =>
  roleOnlyItems.value.find((item) => item.id === selectedRoleItemId.value),
)
const templateNameError = computed(() => {
  const name = templateNameToAdd.value.trim().toLowerCase()
  return name && props.modelValue.some((template) => template.serviceType.toLowerCase() === name)
    ? 'A template with this name already exists.'
    : ''
})
const renameError = computed(() => {
  const name = templateNameDraft.value.trim().toLowerCase()
  if (!name) return 'Enter a template name.'
  return props.modelValue.some(
    (template, index) =>
      index !== selectedIndex.value && template.serviceType.toLowerCase() === name,
  )
    ? 'A template with this name already exists.'
    : ''
})
const groupedRoleOnlyItems = computed(() => {
  const groups: Array<{ category: string; items: ServiceTemplateItem[] }> = []
  const categorizedIds = new Set<string>()
  for (const roleGroup of props.roleGroups) {
    const items = roleOnlyItems.value.filter(
      (item) => !!item.role && roleGroup.roles.includes(item.role),
    )
    if (!items.length) continue
    groups.push({ category: roleGroup.name, items })
    items.forEach((item) => categorizedIds.add(item.id))
  }
  const uncategorized = roleOnlyItems.value.filter(
    (item) => !!item.role && !categorizedIds.has(item.id),
  )
  if (uncategorized.length) groups.push({ category: 'Other Roles', items: uncategorized })
  const awaitingRole = roleOnlyItems.value.filter((item) => !item.role)
  if (awaitingRole.length) groups.push({ category: 'Choose a Role', items: awaitingRole })
  return groups
})

watch(
  () => props.modelValue.length,
  (length) => {
    selectedIndex.value = length ? Math.min(selectedIndex.value, length - 1) : 0
  },
)
watch(
  selectedIndex,
  () => {
    selectedOrderItemId.value = serviceOrderItems.value[0]?.id ?? ''
    selectedRoleItemId.value = roleOnlyItems.value[0]?.id ?? ''
    templateNameDraft.value = selectedTemplate.value?.serviceType ?? ''
  },
  { immediate: true },
)

function itemOption(kind: ServiceTemplateItem['kind']) {
  return KIND_OPTIONS.find((option) => option.value === kind)
}

function itemTitle(item: ServiceTemplateItem) {
  return item.label.trim() || itemOption(item.kind)?.title || 'Service Item'
}

function serviceItemCount(template: ServiceTemplate) {
  return template.items.filter((item) => item.kind !== 'role-only').length
}

function roleRequirementCount(template: ServiceTemplate) {
  return template.items.filter((item) => item.kind === 'role-only').length
}

function effectiveDefaultTypes(template: ServiceTemplate): string[] {
  if (template.defaultForServiceTypes !== undefined) return template.defaultForServiceTypes
  return props.serviceTypes.includes(template.serviceType) ? [template.serviceType] : []
}

function selectTemplate(index: number) {
  selectedIndex.value = index
  activeMode.value = 'order'
  renamingTemplate.value = false
  templateNameDraft.value = props.modelValue[index]?.serviceType ?? ''
}

function beginRenameTemplate() {
  if (!selectedTemplate.value) return
  templateNameDraft.value = selectedTemplate.value.serviceType
  renamingTemplate.value = true
}

function cancelRenameTemplate() {
  templateNameDraft.value = selectedTemplate.value?.serviceType ?? ''
  renamingTemplate.value = false
}

function commitTemplateName() {
  const template = selectedTemplate.value
  const name = templateNameDraft.value.trim()
  if (!template || renameError.value) return
  const templates = [...props.modelValue]
  templates[selectedIndex.value] = {
    ...template,
    serviceType: name,
    // Legacy templates inferred their default from serviceType. Make that relationship explicit
    // before changing the name so renaming never silently changes creation behavior.
    defaultForServiceTypes: template.defaultForServiceTypes ?? effectiveDefaultTypes(template),
  }
  emit('update:modelValue', templates)
  renamingTemplate.value = false
}

function addTemplate() {
  const name = templateNameToAdd.value.trim()
  if (
    !name ||
    props.modelValue.some((template) => template.serviceType.toLowerCase() === name.toLowerCase())
  )
    return
  emit('update:modelValue', [
    ...props.modelValue,
    { serviceType: name, defaultForServiceTypes: [], items: [] },
  ])
  selectedIndex.value = props.modelValue.length
  activeMode.value = 'order'
  templateNameToAdd.value = ''
  creatingTemplate.value = false
}

function cancelAddTemplate() {
  templateNameToAdd.value = ''
  creatingTemplate.value = false
}

function duplicateSelectedTemplate() {
  const template = selectedTemplate.value
  if (!template) return
  const baseName = `${template.serviceType} Copy`
  let name = baseName
  let suffix = 2
  while (
    props.modelValue.some((candidate) => candidate.serviceType.toLowerCase() === name.toLowerCase())
  ) {
    name = `${baseName} ${suffix++}`
  }
  emit('update:modelValue', [
    ...props.modelValue,
    {
      ...template,
      serviceType: name,
      defaultForServiceTypes: [],
      items: template.items.map((item) => ({
        ...item,
        id: `template-item-${crypto.randomUUID()}`,
      })),
    },
  ])
  selectedIndex.value = props.modelValue.length
  activeMode.value = 'order'
  templateNameDraft.value = name
  renamingTemplate.value = true
}

async function removeSelectedTemplate() {
  const template = selectedTemplate.value
  if (!template) return
  if (
    !(await confirmDialog.confirm(
      `Remove the "${template.serviceType}" service template?`,
      'Remove',
    ))
  )
    return
  const remaining = props.modelValue.filter((_, index) => index !== selectedIndex.value)
  const nextIndex = remaining.length ? Math.min(selectedIndex.value, remaining.length - 1) : 0
  emit('update:modelValue', remaining)
  selectedIndex.value = nextIndex
  templateNameDraft.value = remaining[nextIndex]?.serviceType ?? ''
  renamingTemplate.value = false
}

function setItems(items: ServiceTemplateItem[]) {
  const template = selectedTemplate.value
  if (!template) return
  const templates = [...props.modelValue]
  templates[selectedIndex.value] = { ...template, items }
  emit('update:modelValue', templates)
}

function setSelectedTemplate(patch: Partial<ServiceTemplate>) {
  const template = selectedTemplate.value
  if (!template) return
  const templates = [...props.modelValue]
  templates[selectedIndex.value] = { ...template, ...patch }
  emit('update:modelValue', templates)
}

function setItem(itemId: string, patch: Partial<ServiceTemplateItem>) {
  const template = selectedTemplate.value
  const itemIndex = template?.items.findIndex((item) => item.id === itemId) ?? -1
  const item = itemIndex >= 0 ? template?.items[itemIndex] : undefined
  if (!template || !item) return
  const items = [...template.items]
  items[itemIndex] = { ...item, ...patch } as ServiceTemplateItem
  setItems(items)
}

function changeItemKind(item: ServiceTemplateItem, kind: ServiceTemplateItem['kind']) {
  const oldDefaultLabel = itemOption(item.kind)?.title ?? 'Service Item'
  const nextDefaultLabel = itemOption(kind)?.title ?? 'Service Item'
  setItem(item.id, {
    kind,
    label: !item.label.trim() || item.label === oldDefaultLabel ? nextDefaultLabel : item.label,
  })
}

function setServiceOrderItems(items: ServiceTemplateItem[]) {
  setItems([...items, ...roleOnlyItems.value])
}

function addItem(kind: ServiceTemplateItem['kind']) {
  const id = `template-item-${crypto.randomUUID()}`
  const label = itemOption(kind)?.title ?? 'Service Item'
  setItems([...serviceOrderItems.value, { id, kind, label }, ...roleOnlyItems.value])
  selectedOrderItemId.value = id
}

function addRoleRequirement() {
  const id = `template-item-${crypto.randomUUID()}`
  setItems([
    ...serviceOrderItems.value,
    ...roleOnlyItems.value,
    { id, kind: 'role-only', label: '', count: 1 },
  ])
  selectedRoleItemId.value = id
}

function removeItem(itemId: string) {
  const template = selectedTemplate.value
  if (!template) return
  const remaining = template.items.filter((item) => item.id !== itemId)
  setItems(remaining)
  if (selectedOrderItemId.value === itemId) {
    selectedOrderItemId.value = remaining.find((item) => item.kind !== 'role-only')?.id ?? ''
  }
  if (selectedRoleItemId.value === itemId) {
    selectedRoleItemId.value = remaining.find((item) => item.kind === 'role-only')?.id ?? ''
  }
}

function setDefaultTypes(serviceTypes: string[]) {
  const selected = new Set(serviceTypes)
  emit(
    'update:modelValue',
    props.modelValue.map((template, index) => ({
      ...template,
      defaultForServiceTypes:
        index === selectedIndex.value
          ? [...selected]
          : effectiveDefaultTypes(template).filter((type) => !selected.has(type)),
    })),
  )
}
</script>

<template>
  <div class="template-workspace" :class="{ 'template-workspace--standalone': standalone }">
    <aside v-if="!standalone" class="template-directory">
      <header class="directory-heading">
        <div>
          <span>Templates</span>
          <strong>{{ modelValue.length }}</strong>
        </div>
        <v-btn
          size="small"
          variant="flat"
          color="primary"
          prepend-icon="mdi-plus"
          @click="creatingTemplate = true"
        >
          New
        </v-btn>
      </header>

      <v-expand-transition>
        <div v-if="creatingTemplate" class="directory-create">
          <v-text-field
            v-model="templateNameToAdd"
            label="Template name"
            placeholder="Sunday Worship"
            variant="outlined"
            density="compact"
            autofocus
            :error-messages="templateNameError"
            @keydown.enter="addTemplate"
            @keydown.esc="cancelAddTemplate"
          />
          <div>
            <v-btn size="small" variant="text" @click="cancelAddTemplate">Cancel</v-btn>
            <v-btn
              size="small"
              variant="flat"
              color="primary"
              :disabled="!templateNameToAdd.trim() || !!templateNameError"
              @click="addTemplate"
            >
              Create
            </v-btn>
          </div>
        </div>
      </v-expand-transition>

      <div class="template-list">
        <button
          v-for="(template, index) in modelValue"
          :key="`${template.serviceType}-${index}`"
          type="button"
          class="template-list-item"
          :class="{ 'template-list-item--active': selectedIndex === index }"
          @click="selectTemplate(index)"
        >
          <span class="template-list-icon">
            <v-icon icon="mdi-file-tree-outline" size="18" />
          </span>
          <span class="template-list-copy">
            <strong>{{ template.serviceType }}</strong>
            <small>
              {{ serviceItemCount(template) }} order · {{ roleRequirementCount(template) }} roles
            </small>
          </span>
          <v-icon icon="mdi-chevron-right" size="16" />
        </button>
        <div v-if="modelValue.length === 0" class="directory-empty">
          <v-icon icon="mdi-file-plus-outline" size="24" />
          <span>No templates yet</span>
          <button type="button" @click="creatingTemplate = true">Create the first one</button>
        </div>
      </div>
    </aside>

    <section v-if="selectedTemplate" class="template-editor">
      <header v-if="standalone" class="standalone-details">
        <div>
          <span>Template name</span>
          <v-text-field
            :model-value="selectedTemplate.serviceType"
            placeholder="Sunday Worship"
            variant="outlined"
            density="comfortable"
            hide-details
            @update:model-value="(serviceType: string) => setSelectedTemplate({ serviceType })"
          />
        </div>
        <div>
          <span>Description <small>Optional</small></span>
          <v-textarea
            :model-value="selectedTemplate.description"
            placeholder="Describe when this template is useful or what makes it different."
            variant="outlined"
            density="comfortable"
            rows="2"
            auto-grow
            hide-details
            @update:model-value="
              (description: string) =>
                setSelectedTemplate({ description: description || undefined })
            "
          />
        </div>
      </header>

      <header v-else class="editor-heading">
        <div class="editor-title">
          <span>Service template</span>
          <div v-if="renamingTemplate" class="template-name-editor">
            <v-text-field
              v-model="templateNameDraft"
              label="Template name"
              variant="outlined"
              density="compact"
              autofocus
              :error-messages="renameError"
              @keydown.enter="commitTemplateName"
              @keydown.esc="cancelRenameTemplate"
            />
            <v-btn
              icon="mdi-check"
              size="small"
              variant="flat"
              color="primary"
              aria-label="Save template name"
              :disabled="!!renameError"
              @click="commitTemplateName"
            />
            <v-btn
              icon="mdi-close"
              size="small"
              variant="text"
              aria-label="Cancel renaming template"
              @click="cancelRenameTemplate"
            />
          </div>
          <div v-else class="template-name-display">
            <h3>{{ selectedTemplate.serviceType }}</h3>
            <v-btn
              icon="mdi-pencil-outline"
              size="x-small"
              variant="text"
              aria-label="Rename template"
              @click="beginRenameTemplate"
            />
          </div>
        </div>
        <div class="editor-actions">
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-content-copy"
            @click="duplicateSelectedTemplate"
          >
            Duplicate
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            color="error"
            icon="mdi-delete-outline"
            aria-label="Remove template"
            @click="removeSelectedTemplate"
          />
        </div>
      </header>

      <nav class="editor-modes" aria-label="Template editor sections">
        <button
          type="button"
          :class="{ active: activeMode === 'order' }"
          @click="activeMode = 'order'"
        >
          <v-icon icon="mdi-format-list-numbered" size="19" />
          <span
            ><strong>Service Order</strong><small>{{ serviceOrderItems.length }} items</small></span
          >
        </button>
        <button
          type="button"
          :class="{ active: activeMode === 'roles' }"
          @click="activeMode = 'roles'"
        >
          <v-icon icon="mdi-account-multiple-outline" size="19" />
          <span
            ><strong>Additional Roles</strong
            ><small>{{ roleOnlyItems.length }} requirements</small></span
          >
        </button>
        <button
          type="button"
          :class="{ active: activeMode === 'defaults' }"
          @click="activeMode = 'defaults'"
        >
          <v-icon icon="mdi-tune-variant" size="19" />
          <span
            ><strong>Defaults</strong
            ><small>{{ effectiveDefaultTypes(selectedTemplate).length }} service types</small></span
          >
        </button>
      </nav>

      <div v-if="activeMode === 'order'" class="builder-layout">
        <section class="outline-panel">
          <header class="panel-heading">
            <div>
              <strong>Order of service</strong>
              <span>Drag items into the sequence they should be created.</span>
            </div>
            <v-menu location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  size="small"
                  variant="flat"
                  color="primary"
                  prepend-icon="mdi-plus"
                >
                  Add
                </v-btn>
              </template>
              <v-list density="comfortable" min-width="220">
                <v-list-item
                  v-for="option in KIND_OPTIONS"
                  :key="option.value"
                  :title="option.title"
                  :prepend-icon="option.icon"
                  @click="addItem(option.value)"
                />
              </v-list>
            </v-menu>
          </header>

          <VueDraggable
            :model-value="serviceOrderItems"
            handle=".order-grip"
            :animation="150"
            class="order-list"
            @update:model-value="setServiceOrderItems"
          >
            <article
              v-for="(item, index) in serviceOrderItems"
              :key="item.id"
              class="order-row"
              :class="{ 'order-row--active': selectedOrderItemId === item.id }"
              tabindex="0"
              @click="selectedOrderItemId = item.id"
              @keydown.enter="selectedOrderItemId = item.id"
              @keydown.space.prevent="selectedOrderItemId = item.id"
            >
              <v-icon icon="mdi-drag-vertical" size="17" class="order-grip" />
              <span class="order-number">{{ index + 1 }}</span>
              <span class="order-icon"
                ><v-icon :icon="itemOption(item.kind)?.icon" size="18"
              /></span>
              <span class="order-copy">
                <strong>{{ itemTitle(item) }}</strong>
                <small>
                  {{ itemOption(item.kind)?.title
                  }}<template v-if="item.role"> · {{ item.role }}</template>
                </small>
              </span>
              <v-icon icon="mdi-chevron-right" size="16" />
            </article>
          </VueDraggable>

          <div v-if="serviceOrderItems.length === 0" class="outline-empty">
            <v-icon icon="mdi-format-list-bulleted-square" size="27" />
            <strong>No service items</strong>
            <span>Use Add to build the order.</span>
          </div>
        </section>

        <aside class="inspector-panel">
          <template v-if="selectedOrderItem">
            <header class="inspector-heading">
              <span class="inspector-icon">
                <v-icon :icon="itemOption(selectedOrderItem.kind)?.icon" size="20" />
              </span>
              <div>
                <small>Selected item</small>
                <strong>{{ itemTitle(selectedOrderItem) }}</strong>
              </div>
            </header>
            <div class="inspector-fields">
              <div class="field-group">
                <label>Item type</label>
                <v-select
                  :model-value="selectedOrderItem.kind"
                  :items="KIND_OPTIONS"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="
                    (kind: ServiceTemplateItem['kind']) => changeItemKind(selectedOrderItem!, kind)
                  "
                />
              </div>
              <div class="field-group">
                <label>Label</label>
                <v-text-field
                  :model-value="selectedOrderItem.label"
                  placeholder="How this appears in the service"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="(label: string) => setItem(selectedOrderItem!.id, { label })"
                />
              </div>
              <div class="field-group">
                <label>Bulletin note <span>Optional</span></label>
                <v-textarea
                  :model-value="selectedOrderItem.note"
                  placeholder="Text printed beneath this item"
                  variant="outlined"
                  density="compact"
                  rows="3"
                  auto-grow
                  hide-details
                  @update:model-value="
                    (note: string) => setItem(selectedOrderItem!.id, { note: note || undefined })
                  "
                />
              </div>
              <div class="field-group">
                <label>Assigned role <span>Optional</span></label>
                <v-select
                  :model-value="selectedOrderItem.role"
                  :items="roleOptions"
                  placeholder="Who normally handles this item?"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                  @update:model-value="
                    (role: string | undefined) => setItem(selectedOrderItem!.id, { role })
                  "
                />
              </div>
            </div>
            <footer class="inspector-footer">
              <v-btn
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete-outline"
                @click="removeItem(selectedOrderItem.id)"
              >
                Remove Item
              </v-btn>
            </footer>
          </template>
          <div v-else class="inspector-empty">
            <v-icon icon="mdi-cursor-default-click-outline" size="28" />
            <strong>Select an item</strong>
            <span>Its details will appear here.</span>
          </div>
        </aside>
      </div>

      <div v-else-if="activeMode === 'roles'" class="builder-layout">
        <section class="outline-panel">
          <header class="panel-heading">
            <div>
              <strong>Roles outside the order</strong>
              <span>Staffing needs that do not create an order-of-service item.</span>
            </div>
            <v-btn
              size="small"
              variant="flat"
              color="primary"
              prepend-icon="mdi-account-plus-outline"
              @click="addRoleRequirement"
            >
              Add
            </v-btn>
          </header>

          <div class="role-groups">
            <section v-for="group in groupedRoleOnlyItems" :key="group.category" class="role-group">
              <header>
                {{ group.category }} <span>{{ group.items.length }}</span>
              </header>
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="role-row"
                :class="{ 'role-row--active': selectedRoleItemId === item.id }"
                @click="selectedRoleItemId = item.id"
              >
                <span class="role-row-icon"><v-icon icon="mdi-account-outline" size="18" /></span>
                <span>
                  <strong>{{ item.role || 'Choose a role' }}</strong>
                  <small
                    >{{ item.count ?? 1 }}
                    {{ (item.count ?? 1) === 1 ? 'person' : 'people' }}</small
                  >
                </span>
                <v-icon icon="mdi-chevron-right" size="16" />
              </button>
            </section>
          </div>

          <div v-if="roleOnlyItems.length === 0" class="outline-empty">
            <v-icon icon="mdi-account-multiple-plus-outline" size="27" />
            <strong>No additional roles</strong>
            <span>Add staffing that does not belong in the service order.</span>
          </div>
        </section>

        <aside class="inspector-panel">
          <template v-if="selectedRoleItem">
            <header class="inspector-heading">
              <span class="inspector-icon inspector-icon--role">
                <v-icon icon="mdi-account-outline" size="20" />
              </span>
              <div>
                <small>Role requirement</small>
                <strong>{{ selectedRoleItem.role || 'Choose a role' }}</strong>
              </div>
            </header>
            <div class="inspector-fields">
              <div class="field-group">
                <label>Role</label>
                <v-select
                  :model-value="selectedRoleItem.role"
                  :items="roleOptions"
                  placeholder="Select a role"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="
                    (role: string | undefined) =>
                      setItem(selectedRoleItem!.id, { role, label: role ?? '' })
                  "
                />
              </div>
              <div class="field-group">
                <label>People needed</label>
                <v-number-input
                  :model-value="selectedRoleItem.count ?? 1"
                  :min="1"
                  control-variant="split"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="
                    (count: number) => setItem(selectedRoleItem!.id, { count: Math.max(1, count) })
                  "
                />
              </div>
            </div>
            <footer class="inspector-footer">
              <v-btn
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete-outline"
                @click="removeItem(selectedRoleItem.id)"
              >
                Remove Role
              </v-btn>
            </footer>
          </template>
          <div v-else class="inspector-empty">
            <v-icon icon="mdi-cursor-default-click-outline" size="28" />
            <strong>Select a role</strong>
            <span>Its staffing requirement will appear here.</span>
          </div>
        </aside>
      </div>

      <section v-else class="defaults-panel">
        <span class="defaults-icon"><v-icon icon="mdi-calendar-check-outline" size="24" /></span>
        <div class="defaults-copy">
          <span>Automatic selection</span>
          <h4>Use this template by default for</h4>
          <p>
            When a new service has one of these types, Worship Studio preselects this template. Any
            template can still be chosen manually.
          </p>
          <v-select
            :model-value="effectiveDefaultTypes(selectedTemplate)"
            :items="serviceTypes"
            label="Service types"
            variant="outlined"
            density="comfortable"
            multiple
            chips
            closable-chips
            hide-details
            @update:model-value="setDefaultTypes"
          />
        </div>
      </section>
    </section>

    <section v-else class="workspace-empty">
      <span><v-icon icon="mdi-file-plus-outline" size="29" /></span>
      <h3>Create your first service template</h3>
      <p>Templates provide a consistent starting order whenever a service is created.</p>
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-plus"
        @click="creatingTemplate = true"
      >
        New Template
      </v-btn>
    </section>
  </div>
</template>

<style scoped>
.template-workspace {
  display: grid;
  min-height: 610px;
  grid-template-columns: 250px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.65);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.08);
}
.template-workspace--standalone {
  display: block;
  min-height: 0;
}
.template-directory {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-background), 0.28);
}
.directory-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.directory-heading div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.directory-heading span {
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.69rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.directory-heading strong {
  color: rgb(var(--v-theme-primary));
  font-size: 0.73rem;
}
.directory-create {
  padding: 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-primary), 0.045);
}
.directory-create > div:last-child {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 9px;
}
.template-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  padding: 9px;
}
.template-list-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.template-list-item:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
}
.template-list-item--active {
  border-color: rgba(var(--v-theme-primary), 0.18);
  background: rgba(var(--v-theme-primary), 0.1);
}
.template-list-icon,
.order-icon,
.role-row-icon,
.inspector-icon,
.defaults-icon {
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.template-list-icon {
  width: 31px;
  height: 31px;
}
.template-list-copy,
.template-list-copy strong,
.template-list-copy small,
.order-copy,
.order-copy strong,
.order-copy small,
.role-row > span:nth-child(2) {
  display: block;
  min-width: 0;
}
.template-list-copy strong,
.role-row strong {
  overflow: hidden;
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.order-copy strong {
  overflow: hidden;
  font-size: 0.94rem;
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.template-list-copy small,
.role-row small {
  display: block;
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.61rem;
}
.order-copy small {
  display: block;
  margin-top: 3px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
}
.directory-empty,
.outline-empty,
.inspector-empty,
.workspace-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: rgba(var(--v-theme-on-surface), 0.44);
  text-align: center;
}
.directory-empty {
  min-height: 170px;
  gap: 5px;
  font-size: 0.7rem;
}
.directory-empty button {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
}
.template-editor {
  min-width: 0;
  padding: 20px;
}
.standalone-details {
  display: grid;
  grid-template-columns: minmax(240px, 0.72fr) minmax(320px, 1.28fr);
  gap: 18px;
  padding: 2px 0 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.standalone-details > div > span {
  display: block;
  margin-bottom: 7px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 700;
}
.standalone-details > div > span small {
  margin-left: 4px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.62rem;
  font-weight: 500;
}
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.editor-title {
  min-width: 0;
}
.editor-heading > div:first-child > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.62rem;
  font-weight: 720;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.editor-heading h3 {
  margin: 2px 0 0;
  font-size: 1.08rem;
}
.template-name-display {
  display: flex;
  align-items: center;
  gap: 5px;
}
.template-name-editor {
  display: grid;
  width: min(430px, 54vw);
  grid-template-columns: minmax(180px, 1fr) auto auto;
  align-items: start;
  gap: 5px;
  margin-top: 5px;
}
.editor-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.editor-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 18px 0 14px;
}
.editor-modes button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.2);
  color: rgba(var(--v-theme-on-surface), 0.58);
  cursor: pointer;
  text-align: left;
}
.editor-modes button:hover,
.editor-modes button.active {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.editor-modes span,
.editor-modes strong,
.editor-modes small {
  display: block;
}
.editor-modes strong {
  font-size: 0.69rem;
}
.editor-modes small {
  margin-top: 1px;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.59rem;
}
.builder-layout {
  display: grid;
  min-height: 430px;
  grid-template-columns: minmax(300px, 0.85fr) minmax(330px, 1.15fr);
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.18);
}
.outline-panel {
  min-width: 0;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgba(var(--v-theme-surface), 0.42);
}
.panel-heading strong,
.panel-heading span {
  display: block;
}
.panel-heading strong {
  font-size: 0.74rem;
}
.panel-heading span {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.61rem;
  line-height: 1.35;
}
.order-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}
.order-row {
  display: grid;
  grid-template-columns: auto 20px 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 58px;
  padding: 9px 10px 9px 5px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: rgba(var(--v-theme-surface), 0.45);
  cursor: pointer;
}
.order-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.045);
}
.order-row--active,
.role-row--active {
  border-color: rgba(var(--v-theme-primary), 0.2) !important;
  background: rgba(var(--v-theme-primary), 0.09) !important;
}
.order-grip {
  color: rgba(var(--v-theme-on-surface), 0.32);
  cursor: grab;
}
.order-number {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.order-icon,
.role-row-icon {
  width: 31px;
  height: 31px;
}
.outline-empty,
.inspector-empty {
  min-height: 250px;
  gap: 4px;
}
.outline-empty strong,
.inspector-empty strong {
  margin-top: 5px;
  color: rgba(var(--v-theme-on-surface), 0.67);
  font-size: 0.73rem;
}
.outline-empty span,
.inspector-empty span {
  max-width: 250px;
  font-size: 0.63rem;
}
.inspector-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: rgba(var(--v-theme-surface), 0.42);
}
.inspector-heading {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.inspector-icon {
  width: 38px;
  height: 38px;
}
.inspector-icon--role,
.role-row-icon {
  background: rgba(var(--v-theme-teal), 0.09);
  color: rgb(var(--v-theme-teal));
}
.inspector-heading small,
.inspector-heading strong {
  display: block;
}
.inspector-heading small {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.6rem;
  text-transform: uppercase;
}
.inspector-heading strong {
  margin-top: 2px;
  font-size: 0.8rem;
}
.inspector-fields {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}
.field-group > label {
  display: block;
  margin: 0 0 6px 2px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.65rem;
  font-weight: 700;
}
.field-group > label span {
  margin-left: 4px;
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-size: 0.57rem;
  text-transform: uppercase;
}
.field-group :deep(.v-field) {
  border-radius: 7px;
  background: rgba(var(--v-theme-background), 0.35);
}
.inspector-footer {
  display: flex;
  justify-content: flex-end;
  padding: 10px 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.role-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px;
}
.role-group > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.61rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.role-group > header span {
  display: grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 99px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 0.56rem;
}
.role-row {
  display: grid;
  width: 100%;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  margin-top: 3px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: rgba(var(--v-theme-surface), 0.45);
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.defaults-panel {
  display: grid;
  max-width: 720px;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  margin-top: 4px;
  padding: 24px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.22);
}
.defaults-icon {
  width: 46px;
  height: 46px;
}
.defaults-copy > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.61rem;
  font-weight: 720;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
.defaults-copy h4 {
  margin: 3px 0 0;
  font-size: 0.94rem;
}
.defaults-copy p {
  max-width: 560px;
  margin: 6px 0 18px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
  line-height: 1.5;
}
.workspace-empty {
  min-height: 500px;
  padding: 40px;
}
.workspace-empty > span {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.workspace-empty h3 {
  margin: 14px 0 4px;
  font-size: 0.9rem;
}
.workspace-empty p {
  max-width: 350px;
  margin: 0 0 16px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.7rem;
}
@media (max-width: 1050px) {
  .builder-layout {
    grid-template-columns: 1fr;
  }
  .outline-panel {
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  }
}
@media (max-width: 800px) {
  .template-workspace {
    grid-template-columns: 1fr;
  }
  .template-directory {
    border-right: 0;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  }
  .template-list {
    max-height: 230px;
    overflow-y: auto;
  }
}
@media (max-width: 560px) {
  .template-editor {
    padding: 14px;
  }
  .editor-modes {
    grid-template-columns: 1fr;
  }
  .standalone-details {
    grid-template-columns: 1fr;
  }
  .defaults-panel {
    grid-template-columns: 1fr;
  }
}
</style>
