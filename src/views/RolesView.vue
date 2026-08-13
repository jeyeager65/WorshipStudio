<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import RoleGroupEditor from '@/components/settings/RoleGroupEditor.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import { useDocumentHistory } from '@/composables/useDocumentHistory'

const settingsStore = useSettingsStore()
const { librarySettings } = storeToRefs(settingsStore)
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const documentHistory = useDocumentHistory(librarySettings, 'roles')

const categoryCount = computed(() => librarySettings.value?.roleGroups.length ?? 0)
const totalRoles = computed(() =>
  (librarySettings.value?.roleGroups ?? []).reduce((total, group) => total + group.roles.length, 0),
)

onMounted(initialize)

async function initialize() {
  saveHandler.value = saveRoles
  if (!(await settingsStore.load())) return
  isDirty.value = false
  documentHistory.start((dirty) => (isDirty.value = dirty))
}

onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saving.value = false
  saveHandler.value = undefined
})

async function saveRoles() {
  if (!librarySettings.value || saving.value) return
  saving.value = true
  try {
    await settingsStore.save()
    isDirty.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="roles-page">
    <header class="roles-hero">
      <div>
        <div class="page-eyebrow">Service Planning</div>
        <h1>Roles</h1>
        <p>Organize the responsibilities used in templates, assignments, and planning reports.</p>
      </div>
      <div class="roles-summary" aria-label="Roles summary">
        <div class="summary-stat">
          <strong>{{ categoryCount }}</strong>
          <span>Categories</span>
        </div>
        <div class="summary-stat">
          <strong>{{ totalRoles }}</strong>
          <span>Roles</span>
        </div>
      </div>
    </header>

    <AsyncLoadState
      v-if="!settingsStore.loaded"
      :loading="settingsStore.loading"
      :error="settingsStore.loadError"
      label="roles"
      @retry="initialize"
    />
    <template v-else>
      <v-alert
        v-if="settingsStore.mutationError"
        type="error"
        variant="tonal"
        closable
        class="roles-directory mb-4"
        @click:close="settingsStore.clearMutationError"
      >
        Role changes were not saved: {{ settingsStore.mutationError }}
      </v-alert>
      <div class="roles-directory">
        <RoleGroupEditor v-if="librarySettings" v-model="librarySettings.roleGroups" />
      </div>
    </template>
  </main>
</template>

<style scoped>
.roles-page {
  min-height: calc(100vh - 49px);
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-primary), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
.roles-hero,
.roles-directory {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
}
.roles-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 36px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.page-eyebrow {
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.roles-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.roles-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.roles-summary {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.42);
}
.summary-stat {
  display: flex;
  min-width: 105px;
  flex-direction: column;
  align-items: center;
  padding: 11px 15px;
  border-right: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.summary-stat:last-child {
  border-right: 0;
}
.summary-stat strong {
  color: rgb(var(--v-theme-primary));
  font-size: 1.12rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.summary-stat span {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.035em;
  text-align: center;
  text-transform: uppercase;
}
@media (max-width: 880px) {
  .roles-hero {
    align-items: stretch;
    flex-direction: column;
  }
  .roles-summary {
    align-self: flex-start;
  }
}
@media (max-width: 700px) {
  .roles-page {
    padding: 14px 12px 40px;
  }
  /* The whole hero card (eyebrow, title, description, stats) is nice-to-have context, not
     essential, and it eats space that matters more on a narrow/short screen. */
  .roles-hero {
    display: none;
  }
}
</style>
