<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { sermonMainReference } from '@/utils/sermonInfo'
import type { Service, ServiceItem } from '@/models/service'
import type { AddItemType } from './AddServiceItemDialog.vue'

const props = defineProps<{
  service: Service
  addTabOptions: { title: string; description: string; icon: string; value: AddItemType }[]
  itemLabel: (item: ServiceItem) => string
  itemColor: (item: ServiceItem) => string
  itemHasLive: (index: number) => boolean
}>()
const emit = defineEmits<{ 'open-add-dialog': [AddItemType] }>()

const selectedItemIndex = defineModel<number>('selectedItemIndex', { required: true })

const confirmDialog = useConfirmDialogStore()

// Off by default — accidental drags while just browsing/clicking the Service Order list would
// be far more disruptive here than useful, so reordering is opt-in via the toggle next to the
// header rather than always-on.
const reorderMode = ref(false)
const selectedItem = computed(() => props.service.items[selectedItemIndex.value])
// selectedItemIndex is a raw array position, not an id — capture the selected item's own id
// before a drag starts so it can be re-found by id afterward, otherwise the "selected" item
// would silently become whatever ended up at that same index once the drag reshuffles the array.
const draggingItemId = ref<string>()
function onReorderStart() {
  draggingItemId.value = selectedItem.value?.id
}
function onReorderEnd() {
  if (draggingItemId.value) {
    const newIndex = props.service.items.findIndex((i) => i.id === draggingItemId.value)
    if (newIndex !== -1) selectedItemIndex.value = newIndex
  }
  draggingItemId.value = undefined
}

// VueDraggable's v-model reassigns the whole array on drop — aliased to a local so eslint's
// no-mutating-props check (which only pattern-matches direct props.x member expressions)
// doesn't flag what's actually a deliberate, parent-approved mutation (same reactive array
// the parent's own service ref holds).
const serviceItems = computed({
  get: () => props.service.items,
  set: (value) => {
    const svc = props.service
    svc.items = value
  },
})

function itemIcon(item: ServiceItem): string {
  switch (item.type) {
    case 'song':
      return 'mdi-music-note'
    case 'scripture':
      return 'mdi-book-open-page-variant'
    case 'text-slide':
    case 'slide-ref':
      return 'mdi-file-document-outline'
    case 'media':
      return 'mdi-image'
    case 'video':
      return 'mdi-movie-open'
    case 'audio':
      return 'mdi-volume-high'
    case 'external-app':
      return 'mdi-application'
    case 'countdown':
      return 'mdi-timer-outline'
    case 'qr':
      return 'mdi-qrcode'
    case 'sermon':
      return 'mdi-account-voice'
    case 'bulletin-note':
      return 'mdi-note-text-outline'
    case 'placeholder':
      return 'mdi-help-rhombus-outline'
    default:
      return 'mdi-file'
  }
}

// sermon/bulletin-note/placeholder already resolve bulletinLabel as their own itemLabel() —
// showing it again as a distinct first line would just repeat the exact same text.
const BULLETIN_LABEL_DRIVEN_TYPES = new Set(['sermon', 'bulletin-note', 'placeholder'])

// For every other item type, an explicit bulletinLabel override takes the first line (with
// the item's own default content — song title, scripture reference, etc. — moved to the
// second line below), same as sermon/bulletin-note already prioritize it as their whole label.
function serviceOrderPrimaryLabel(item: ServiceItem): string {
  if (item.bulletinLabel && !BULLETIN_LABEL_DRIVEN_TYPES.has(item.type)) return item.bulletinLabel
  return props.itemLabel(item)
}

function serviceOrderSecondaryLabel(item: ServiceItem): string | undefined {
  if (item.type === 'sermon') return sermonMainReference(item) || undefined
  if (item.bulletinLabel && !BULLETIN_LABEL_DRIVEN_TYPES.has(item.type)) return props.itemLabel(item)
  return undefined
}

async function removeServiceItem(index: number) {
  const svc = props.service
  const target = svc.items[index]
  if (!target) return
  const label = props.itemLabel(target)
  if (!(await confirmDialog.confirm(`Remove "${label}" from the service?`, 'Remove'))) return
  svc.items.splice(index, 1)
  if (selectedItemIndex.value >= svc.items.length) {
    selectedItemIndex.value = Math.max(0, svc.items.length - 1)
  }
}
</script>

<template>
  <div class="service-panel">
    <div class="service-panel-header">
      <div>
        <div class="panel-title">Order of Service</div>
        <div class="panel-subtitle">
          {{ service.items.length }} item{{ service.items.length === 1 ? '' : 's' }}
        </div>
      </div>
      <v-btn
        :icon="reorderMode ? 'mdi-check' : 'mdi-swap-vertical'"
        variant="text"
        size="small"
        :title="reorderMode ? 'Done reordering' : 'Reorder items'"
        @click="reorderMode = !reorderMode"
      />
    </div>
    <v-menu location="bottom" :close-on-content-click="true">
      <template #activator="{ props: activatorProps }">
        <button v-bind="activatorProps" type="button" class="add-service-button">
          <span class="add-service-button-main">
            <v-icon icon="mdi-plus" size="20" />
            <span>Add Item</span>
          </span>
          <span class="add-service-button-chevron">
            <v-icon icon="mdi-chevron-down" size="18" />
          </span>
        </button>
      </template>
      <v-list class="add-item-menu" density="compact">
        <v-list-item
          v-for="option in addTabOptions"
          :key="option.value"
          :title="option.title"
          :subtitle="option.description"
          :prepend-icon="option.icon"
          @click="emit('open-add-dialog', option.value)"
        />
      </v-list>
    </v-menu>
    <div class="service-list flex-grow-1 overflow-y-auto">
      <VueDraggable
        v-if="reorderMode"
        v-model="serviceItems"
        handle=".service-item-drag-handle"
        :animation="150"
        :on-start="onReorderStart"
        :on-end="onReorderEnd"
      >
        <div
          v-for="(item, index) in service.items"
          :key="item.id"
          :data-service-item-id="item.id"
          class="service-item"
          :class="{
            'service-item--selected': index === selectedItemIndex,
            'service-item--live': itemHasLive(index),
          }"
          @click="selectedItemIndex = index"
        >
          <span class="service-item-index">{{ index + 1 }}</span>
          <v-icon
            icon="mdi-drag-vertical"
            class="service-item-drag-handle"
            size="small"
            style="cursor: grab"
          />
          <div class="flex-grow-1" style="min-width: 0">
            <div :class="{ 'font-italic': item.type === 'placeholder' }">
              {{ serviceOrderPrimaryLabel(item) }}
            </div>
            <div v-if="serviceOrderSecondaryLabel(item)" class="text-caption text-medium-emphasis">
              {{ serviceOrderSecondaryLabel(item) }}
            </div>
          </div>
        </div>
      </VueDraggable>
      <template v-else>
        <div
          v-for="(item, index) in service.items"
          :key="item.id"
          :data-service-item-id="item.id"
          class="service-item"
          :class="{
            'service-item--selected': index === selectedItemIndex,
            'service-item--live': itemHasLive(index),
          }"
          @click="selectedItemIndex = index"
        >
          <span class="service-item-index">{{ index + 1 }}</span>
          <span class="service-item-icon" :style="{ color: `rgb(var(--v-theme-${itemColor(item)}))` }">
            <v-icon :icon="itemIcon(item)" size="17" />
          </span>
          <div class="flex-grow-1" style="min-width: 0">
            <div class="service-item-title" :class="{ 'font-italic': item.type === 'placeholder' }">
              {{ serviceOrderPrimaryLabel(item) }}
            </div>
            <div v-if="serviceOrderSecondaryLabel(item)" class="text-caption text-medium-emphasis">
              {{ serviceOrderSecondaryLabel(item) }}
            </div>
          </div>
          <v-btn
            icon="mdi-trash-can-outline"
            variant="text"
            class="row-remove"
            size="x-small"
            title="Remove from service"
            @click.stop="removeServiceItem(index)"
          />
        </div>
      </template>
    </div>
    <div v-if="reorderMode" class="service-panel-footer">
      <v-icon icon="mdi-drag-vertical" size="14" />
      <span>Drag items into order</span>
    </div>
  </div>
</template>

<style scoped>
.service-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  background: rgb(var(--v-theme-surface));
  min-height: 0;
}
.service-panel-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  min-height: 62px;
  padding: 11px 16px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.panel-title {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}
.panel-subtitle {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
}
.add-service-button {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
  width: calc(100% - 24px);
  height: 42px;
  margin: 12px 12px 5px;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 7px;
  background: rgba(var(--v-theme-surface-variant), 0.42);
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast);
}
.add-service-button:hover,
.add-service-button[aria-expanded='true'] {
  border-color: rgba(var(--v-theme-primary), 0.48);
  background: rgba(var(--v-theme-primary), 0.1);
}
.add-service-button:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.72);
  outline-offset: 2px;
}
.add-service-button-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 13px;
}
.add-service-button-chevron {
  display: grid;
  width: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.add-item-menu {
  width: 330px;
  max-height: min(620px, calc(100vh - 120px));
  padding: 6px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.28);
}
.add-item-menu :deep(.v-list-item) {
  min-height: 52px;
  margin-bottom: 2px;
  border-radius: 7px;
}
.add-item-menu :deep(.v-list-item-subtitle) {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
}
.service-list {
  padding: 7px 8px 10px;
}
.service-panel-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 38px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.service-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 53px;
  padding: 7px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.055);
  border-radius: 7px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  cursor: pointer;
  font-size: 0.84rem;
  margin-bottom: 5px;
  transition:
    background-color 130ms ease,
    border-color 130ms ease,
    box-shadow 130ms ease,
    transform 130ms ease;
}
.service-item:hover {
  border-color: rgba(var(--v-theme-primary), 0.25);
  background: rgba(var(--v-theme-primary), 0.08);
}
.service-item--selected {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.14);
  box-shadow: inset 3px 0 rgb(var(--v-theme-primary));
}
.service-item--live {
  box-shadow: inset 3px 0 rgb(var(--v-theme-error));
}
.service-item--selected.service-item--live {
  box-shadow:
    inset 3px 0 rgb(var(--v-theme-error)),
    inset 0 0 0 1px rgba(var(--v-theme-primary), 0.2);
}
.service-item-index {
  width: 16px;
  flex: 0 0 16px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.service-item-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.service-item-title {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-remove {
  opacity: 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  transition:
    opacity 120ms ease,
    color 120ms ease;
}
.service-item:hover .row-remove {
  opacity: 1;
}
.row-remove:hover {
  color: rgb(var(--v-theme-error));
}
</style>
