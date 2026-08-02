<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, toRaw } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { getAdapter } from '@/adapters'
import ServiceTemplateEditor from '@/components/settings/ServiceTemplateEditor.vue'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import { errorMessage } from '@/composables/useAsyncStoreState'
import { useDocumentHistory } from '@/composables/useDocumentHistory'
import { useSettingsStore } from '@/stores/settings'
import { useUnsavedChangesStore } from '@/stores/unsavedChanges'
import type { ServiceTemplate } from '@/models/service'

const route = useRoute()
const router = useRouter()
const settingsStore = useSettingsStore()
const { isDirty, saving, saveHandler } = storeToRefs(useUnsavedChangesStore())
const workingTemplates = ref<ServiceTemplate[]>([])
const selectedIndex = ref(0)
const validationMessage = ref('')
const saveMessage = ref('')
const missingTemplate = ref(false)
const originalTemplateName = ref('')
const documentHistory = useDocumentHistory(workingTemplates, 'service template')

const selectedTemplate = computed(() => workingTemplates.value[selectedIndex.value])
const heading = computed(() => selectedTemplate.value?.serviceType.trim() || 'New Service Template')

function persistenceClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

onMounted(initialize)

async function initialize() {
  documentHistory.stop()
  if (!(await settingsStore.load())) return
  const storedTemplates = settingsStore.librarySettings?.serviceTemplates ?? []
  workingTemplates.value = structuredClone(toRaw(storedTemplates))

  if (route.name === 'service-template-new') {
    selectedIndex.value = workingTemplates.value.length
    workingTemplates.value.push({
      serviceType: '',
      description: '',
      defaultForServiceTypes: [],
      items: [],
    })
    isDirty.value = true
  } else {
    const name = String(route.params.templateName ?? '')
    const index = workingTemplates.value.findIndex((template) => template.serviceType === name)
    if (index === -1) {
      missingTemplate.value = true
      return
    }
    selectedIndex.value = index
    originalTemplateName.value = name
    const template = workingTemplates.value[index]!
    if (template.defaultForServiceTypes === undefined) {
      template.defaultForServiceTypes = settingsStore.librarySettings?.serviceTypes.includes(
        template.serviceType,
      )
        ? [template.serviceType]
        : []
    }
    isDirty.value = false
  }

  documentHistory.start(
    (dirty) => (isDirty.value = dirty),
    route.name === 'service-template-new',
  )
  saveHandler.value = saveTemplate
}

onUnmounted(() => {
  documentHistory.stop()
  isDirty.value = false
  saveHandler.value = undefined
})

async function saveTemplate() {
  const template = selectedTemplate.value
  if (!template || !settingsStore.librarySettings || saving.value) return
  const name = template.serviceType.trim()
  if (!name) {
    validationMessage.value = 'Enter a template name before saving.'
    saveMessage.value = ''
    return
  }
  if (
    workingTemplates.value.some(
      (candidate, index) =>
        index !== selectedIndex.value &&
        candidate.serviceType.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    validationMessage.value = 'A template with this name already exists.'
    saveMessage.value = ''
    return
  }

  template.serviceType = name
  template.description = template.description?.trim() || undefined
  validationMessage.value = ''
  saveMessage.value = ''
  saving.value = true
  try {
    // Vue can leave nested editor values wrapped in reactive proxies. Serialize at the IPC
    // boundary both to unwrap them reliably and to produce exactly the JSON shape Tauri receives.
    const nextLibrarySettings = persistenceClone(toRaw(settingsStore.librarySettings))
    nextLibrarySettings.serviceTemplates = persistenceClone(toRaw(workingTemplates.value))
    await settingsStore.runMutation(() =>
      getAdapter().settings.saveLibrarySettings(nextLibrarySettings),
    )
    settingsStore.librarySettings = nextLibrarySettings
    isDirty.value = false
    saveMessage.value = 'Template saved.'
    if (route.name === 'service-template-new' || originalTemplateName.value !== name) {
      originalTemplateName.value = name
      await router.replace({ name: 'service-template-editor', params: { templateName: name } })
    }
  } catch (error) {
    console.error('Failed to save service template:', error)
    validationMessage.value = `The template could not be saved. Your changes are still here. ${errorMessage(error)}`
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="template-editor-page">
    <header class="page-header">
      <div>
        <v-btn
          :to="{ name: 'service-template-library' }"
          variant="text"
          prepend-icon="mdi-arrow-left"
          class="back-button"
          >Service Templates</v-btn
        >
        <div class="page-eyebrow">Template Editor</div>
        <h1>{{ heading }}</h1>
        <p>Design the starting order, additional staffing, and automatic service-type selection.</p>
      </div>
    </header>

    <v-alert
      v-if="settingsStore.mutationError"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="settingsStore.clearMutationError"
      >Template changes were not saved: {{ settingsStore.mutationError }}</v-alert
    >
    <v-alert
      v-if="validationMessage"
      type="warning"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="validationMessage = ''"
      >{{ validationMessage }}</v-alert
    >
    <v-alert
      v-if="saveMessage"
      type="success"
      variant="tonal"
      density="compact"
      closable
      class="mb-4"
      @click:close="saveMessage = ''"
      >{{ saveMessage }}</v-alert
    >
    <AsyncLoadState
      v-if="!settingsStore.loaded"
      :loading="settingsStore.loading"
      :error="settingsStore.loadError"
      label="service template"
      @retry="initialize"
    />
    <section v-else-if="missingTemplate" class="missing-state">
      <v-icon icon="mdi-file-question-outline" size="38" />
      <h2>Template Not Found</h2>
      <p>It may have been renamed or removed on another computer.</p>
      <v-btn :to="{ name: 'service-template-library' }" color="primary" variant="flat"
        >Return to Templates</v-btn
      >
    </section>
    <ServiceTemplateEditor
      v-else-if="settingsStore.librarySettings && selectedTemplate"
      v-model="workingTemplates"
      :role-groups="settingsStore.librarySettings.roleGroups"
      :service-types="settingsStore.librarySettings.serviceTypes"
      :initial-selected-index="selectedIndex"
      standalone
    />
  </main>
</template>

<style scoped>
.template-editor-page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 28px 34px 54px;
}
.page-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}
.back-button {
  margin: 0 0 16px -12px;
}
.page-eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
h1 {
  margin: 3px 0 5px;
  font-size: 1.85rem;
  line-height: 1.15;
}
.page-header p {
  max-width: 700px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.82rem;
}
.missing-state {
  display: flex;
  min-height: 420px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 13px;
  background: rgba(var(--v-theme-surface), 0.65);
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: center;
}
.missing-state h2 {
  margin: 13px 0 4px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
}
.missing-state p {
  margin: 0 0 18px;
  font-size: 0.75rem;
}
@media (max-width: 700px) {
  .template-editor-page {
    padding: 20px 16px 40px;
  }
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
  .page-header .v-btn {
    align-self: flex-start;
  }
}
</style>
