<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useServiceTypesStore } from '@/stores/serviceTypes'

const store = useServiceTypesStore()
const confirmDialog = useConfirmDialogStore()
const newTypeName = ref('')

onMounted(() => store.load())

function addType() {
  const name = newTypeName.value.trim()
  if (
    !name ||
    store.serviceTypes.some((type) => type.name.toLowerCase() === name.toLowerCase())
  )
    return
  store.save({ id: `type-${crypto.randomUUID()}`, name })
  newTypeName.value = ''
}

function updateDescription(typeId: string, description: string) {
  const type = store.serviceTypes.find((t) => t.id === typeId)
  if (!type) return
  store.save({ ...type, description: description || undefined })
}

function trimDescription(typeId: string) {
  const type = store.serviceTypes.find((t) => t.id === typeId)
  updateDescription(typeId, type?.description?.trim() ?? '')
}

async function removeType(typeId: string) {
  const type = store.serviceTypes.find((t) => t.id === typeId)
  if (!type) return
  if (!(await confirmDialog.confirm(`Remove "${type.name}"?`, 'Remove'))) return
  store.remove(typeId)
}
</script>

<template>
  <div class="service-type-settings">
    <div v-if="store.serviceTypes.length" class="service-type-list">
      <div v-for="type in store.serviceTypes" :key="type.id" class="service-type-row">
        <div class="service-type-identity">
          <v-icon icon="mdi-calendar-multiple" size="20" />
          <strong>{{ type.name }}</strong>
        </div>
        <v-text-field
          :model-value="type.description"
          label="Description"
          placeholder="Optional"
          variant="outlined"
          density="compact"
          hide-details
          @update:model-value="(value: string) => updateDescription(type.id, value)"
          @blur="trimDescription(type.id)"
        />
        <v-btn
          icon="mdi-trash-can-outline"
          variant="text"
          color="error"
          aria-label="Remove service type"
          @click="removeType(type.id)"
        />
      </div>
    </div>
    <p v-else class="text-medium-emphasis text-body-2">No service types configured yet.</p>

    <div class="add-service-type">
      <v-text-field
        v-model="newTypeName"
        label="Add a service type…"
        variant="outlined"
        density="compact"
        hide-details
        @keydown.enter="addType"
      />
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="addType">
        Add Service Type
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.service-type-settings,
.service-type-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.service-type-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 340px) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.2);
}
.service-type-identity {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.service-type-identity strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add-service-type {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 560px);
  margin-top: 4px;
}
@media (max-width: 760px) {
  .service-type-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .service-type-row :deep(.v-input) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .add-service-type {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
