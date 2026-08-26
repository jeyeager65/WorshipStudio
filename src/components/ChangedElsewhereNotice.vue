<script setup lang="ts">
/**
 * Warns that the record this editor has open was changed on another device.
 *
 * Reloading a store never reaches an open editor — editors hold a private copy of their record —
 * so without this the operator saves their draft and silently overwrites the other device's change.
 * There is no version check anywhere in the save path, and no conflicted-copy artifact is produced,
 * so nothing else would ever mention it.
 *
 * Deliberately a warning, not a resolution flow. The provider's conflicted-copy machinery
 * (SyncConflictsView) handles two *saved* versions it could not merge; here the other save landed
 * cleanly and only this editor's unsaved draft is stale. Last-write-wins remains the behaviour —
 * for a service edited on the presenting machine mid-service, that machine should win, and does.
 * What was missing was telling anyone before they commit to it.
 */
withDefaults(
  defineProps<{
    /** What was changed, for the message: "person", "song", "service". */
    noun: string
    /** Whether the operator has unsaved edits that would be lost by taking the newer version. */
    hasUnsavedChanges: boolean
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{ reload: []; keep: [] }>()
</script>

<template>
  <v-alert type="warning" variant="tonal" density="comfortable" class="mb-4">
    <div class="notice-body">
      <span>
        This {{ noun }} was changed on another device{{
          hasUnsavedChanges
            ? '. Saving will overwrite that change with what you have here.'
            : ' since you opened it.'
        }}
      </span>
      <div class="notice-actions">
        <v-btn
          size="small"
          variant="flat"
          color="warning"
          :loading="loading"
          @click="emit('reload')"
        >
          {{ hasUnsavedChanges ? 'Discard Mine & Load Theirs' : 'Load Their Version' }}
        </v-btn>
        <v-btn size="small" variant="text" :disabled="loading" @click="emit('keep')">
          {{ hasUnsavedChanges ? 'Keep Mine' : 'Dismiss' }}
        </v-btn>
      </div>
    </div>
  </v-alert>
</template>

<style scoped>
.notice-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.notice-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}
</style>
