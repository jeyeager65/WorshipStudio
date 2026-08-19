<script setup lang="ts">
import { ref } from 'vue'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import { useSongCollectionsStore } from '@/stores/songCollections'

// Loaded by SettingsView.vue itself, not here — abbreviation edits below are part of its shared
// settingsDocument now (see that file's own comment), so it owns this store's load lifecycle
// too rather than this component racing it with a second, redundant load() call.
const store = useSongCollectionsStore()
const confirmDialog = useConfirmDialogStore()
const newCollectionName = ref('')

// addCollection/removeCollection persist immediately (like LibrarySyncSection.vue's Data Tools
// actions), but store.collections is now part of SettingsView.vue's tracked settingsDocument too
// (for abbreviation edits) — without this, the array changing out from under that deep-watch
// would wrongly flag the page as having unsaved changes for something already fully persisted.
// Same event name/handler (rebaselineHistory) as LibrarySyncSection.vue's identical problem.
const emit = defineEmits<{ 'bulk-data-change': [] }>()

async function addCollection() {
  const name = newCollectionName.value.trim()
  if (
    !name ||
    store.collections.some((collection) => collection.name.toLowerCase() === name.toLowerCase())
  )
    return
  await store.save({ id: `collection-${crypto.randomUUID()}`, name })
  newCollectionName.value = ''
  emit('bulk-data-change')
}

// Unlike addCollection/removeCollection (immediate, deliberate actions), abbreviation edits are
// deferred to SettingsView.vue's own Save button for consistency with every other field there —
// this just mutates the shared reactive item; that page's saveSettings() persists whatever
// actually changed once Save is clicked.
function updateAbbreviation(collectionId: string, abbreviation: string) {
  const collection = store.collections.find((c) => c.id === collectionId)
  if (!collection) return
  collection.abbreviation = abbreviation || undefined
}

function trimAbbreviation(collectionId: string) {
  const collection = store.collections.find((c) => c.id === collectionId)
  if (!collection) return
  collection.abbreviation = collection.abbreviation?.trim() || undefined
}

async function removeCollection(collectionId: string) {
  const collection = store.collections.find((c) => c.id === collectionId)
  if (!collection) return
  if (!(await confirmDialog.confirm(`Remove "${collection.name}"?`, 'Remove'))) return
  await store.remove(collectionId)
  emit('bulk-data-change')
}
</script>

<template>
  <div class="collection-settings">
    <div v-if="store.collections.length" class="collection-list">
      <div v-for="collection in store.collections" :key="collection.id" class="collection-row">
        <div class="collection-identity">
          <v-icon icon="mdi-bookshelf" size="20" />
          <div>
            <strong>{{ collection.name }}</strong>
            <small>
              Bulletin example:
              {{
                collection.abbreviation?.trim() ? `${collection.abbreviation.trim()} 184` : '184'
              }}
            </small>
          </div>
        </div>
        <v-text-field
          :model-value="collection.abbreviation"
          label="Bulletin abbreviation"
          placeholder="Optional"
          variant="outlined"
          density="compact"
          maxlength="12"
          hide-details
          @update:model-value="(value: string) => updateAbbreviation(collection.id, value)"
          @blur="trimAbbreviation(collection.id)"
        />
        <v-btn
          icon="mdi-trash-can-outline"
          variant="text"
          color="error"
          aria-label="Remove collection"
          @click="removeCollection(collection.id)"
        />
      </div>
    </div>
    <p v-else class="text-medium-emphasis text-body-2">No collections configured yet.</p>

    <div class="add-collection">
      <v-text-field
        v-model="newCollectionName"
        label="Add a collection…"
        variant="outlined"
        density="compact"
        hide-details
        @keydown.enter="addCollection"
      />
      <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="addCollection">
        Add Collection
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.collection-settings,
.collection-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.collection-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(180px, 240px) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.2);
}
.collection-identity {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.collection-identity > div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.collection-identity strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-identity small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.56);
}
.add-collection {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 560px);
  margin-top: 4px;
}
@media (max-width: 760px) {
  .collection-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .collection-row :deep(.v-input) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .add-collection {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
