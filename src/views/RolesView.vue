<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import RoleGroupEditor from '@/components/settings/RoleGroupEditor.vue'

const settingsStore = useSettingsStore()
const { librarySettings } = storeToRefs(settingsStore)
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
let ready = false

watch(
  () => librarySettings.value?.roleGroups,
  () => {
    if (ready) isDirty.value = true
  },
  { deep: true },
)

onMounted(async () => {
  saveHandler.value = saveRoles
  await settingsStore.load()
  await nextTick()
  ready = true
  isDirty.value = false
})

onUnmounted(() => {
  ready = false
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
        <span>Service Planning</span>
        <h1>Roles</h1>
        <p>Organize the responsibilities used in templates, assignments, and planning reports.</p>
      </div>
      <span class="roles-hero-icon"><v-icon icon="mdi-account-badge-outline" size="28" /></span>
    </header>

    <RoleGroupEditor v-if="librarySettings" v-model="librarySettings.roleGroups" />
  </main>
</template>

<style scoped>
.roles-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 30px 34px 56px;
}
.roles-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding: 22px 24px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background:
    radial-gradient(circle at 92% 0, rgba(var(--v-theme-primary), 0.09), transparent 180px),
    rgba(var(--v-theme-surface), 0.72);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.07);
}
.roles-hero > div > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.66rem;
  font-weight: 740;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.roles-hero h1 {
  margin: 3px 0 0;
  font-size: 1.45rem;
  letter-spacing: -0.025em;
}
.roles-hero p {
  max-width: 680px;
  margin: 7px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.53);
  font-size: 0.76rem;
}
.roles-hero-icon {
  display: grid;
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.15);
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
@media (max-width: 760px) {
  .roles-page {
    padding: 22px 16px 42px;
  }
  .roles-hero {
    padding: 18px;
  }
  .roles-hero-icon {
    display: none;
  }
}
</style>
