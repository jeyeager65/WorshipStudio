<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import type { ServiceTemplate } from '@/models/service'

const router = useRouter()
const settingsStore = useSettingsStore()
const confirmDialog = useConfirmDialogStore()
const searchQuery = ref('')
const saving = ref(false)

onMounted(() => settingsStore.load())

const templates = computed(() => settingsStore.librarySettings?.serviceTemplates ?? [])
const filteredTemplates = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return [...templates.value]
    .sort((a, b) => a.serviceType.localeCompare(b.serviceType))
    .filter(
      (template) =>
        !query ||
        template.serviceType.toLowerCase().includes(query) ||
        template.description?.toLowerCase().includes(query) ||
        effectiveDefaultTypes(template).some((type) => type.toLowerCase().includes(query)),
    )
})

function effectiveDefaultTypes(template: ServiceTemplate): string[] {
  if (template.defaultForServiceTypes !== undefined) return template.defaultForServiceTypes
  return settingsStore.librarySettings?.serviceTypes.includes(template.serviceType)
    ? [template.serviceType]
    : []
}

function serviceItemCount(template: ServiceTemplate): number {
  return template.items.filter((item) => item.kind !== 'role-only').length
}

function roleCount(template: ServiceTemplate): number {
  return template.items.filter((item) => item.kind === 'role-only').length
}

function openTemplate(template: ServiceTemplate) {
  void router.push({
    name: 'service-template-editor',
    params: { templateName: template.serviceType },
  })
}

function createTemplate() {
  void router.push({ name: 'service-template-new' })
}

async function persistTemplates(next: ServiceTemplate[]) {
  if (!settingsStore.librarySettings) return
  saving.value = true
  try {
    settingsStore.librarySettings.serviceTemplates = structuredClone(toRaw(next))
    await settingsStore.save()
  } finally {
    saving.value = false
  }
}

async function duplicateTemplate(template: ServiceTemplate) {
  const baseName = `${template.serviceType} Copy`
  let name = baseName
  let suffix = 2
  while (
    templates.value.some((candidate) => candidate.serviceType.toLowerCase() === name.toLowerCase())
  ) {
    name = `${baseName} ${suffix++}`
  }
  const duplicate: ServiceTemplate = {
    ...structuredClone(toRaw(template)),
    serviceType: name,
    description: template.description
      ? `Copy of ${template.serviceType}. ${template.description}`
      : `Copy of ${template.serviceType}.`,
    defaultForServiceTypes: [],
    items: template.items.map((item) => ({
      ...structuredClone(toRaw(item)),
      id: `template-item-${crypto.randomUUID()}`,
    })),
  }
  await persistTemplates([...templates.value, duplicate])
  openTemplate(duplicate)
}

async function deleteTemplate(template: ServiceTemplate) {
  if (!(await confirmDialog.confirm(`Delete the "${template.serviceType}" template?`, 'Delete')))
    return
  await persistTemplates(templates.value.filter((candidate) => candidate !== template))
}
</script>

<template>
  <main class="templates-page">
    <header class="templates-hero">
      <div>
        <v-btn to="/settings" variant="text" prepend-icon="mdi-arrow-left" class="back-button"
          >Settings</v-btn
        >
        <div class="page-eyebrow">Service Planning</div>
        <h1>Service Templates</h1>
        <p>
          Build reusable starting points for service orders, staffing, and service-type defaults.
        </p>
      </div>
      <div class="hero-count">
        <strong>{{ templates.length }}</strong
        ><span>Templates</span>
      </div>
    </header>

    <section class="template-directory">
      <div class="directory-toolbar">
        <div>
          <h2>Template Library</h2>
          <p>
            {{ filteredTemplates.length }}
            {{ filteredTemplates.length === 1 ? 'template' : 'templates' }}
          </p>
        </div>
        <div class="toolbar-actions">
          <v-text-field
            v-if="templates.length"
            v-model="searchQuery"
            prepend-inner-icon="mdi-magnify"
            placeholder="Search templates"
            aria-label="Search templates"
            variant="outlined"
            density="compact"
            hide-details
            clearable
          />
          <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTemplate"
            >New Template</v-btn
          >
        </div>
      </div>

      <div v-if="templates.length === 0" class="empty-state">
        <span><v-icon icon="mdi-file-tree-outline" size="30" /></span>
        <h2>No Service Templates Yet</h2>
        <p>Create a reusable order and staffing plan for your first service type.</p>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTemplate"
          >New Template</v-btn
        >
      </div>
      <div v-else-if="filteredTemplates.length === 0" class="empty-state">
        <span><v-icon icon="mdi-file-search-outline" size="30" /></span>
        <h2>No Matching Templates</h2>
        <p>Try a different name, description, or service type.</p>
      </div>
      <div v-else class="template-grid">
        <article
          v-for="template in filteredTemplates"
          :key="template.serviceType"
          class="template-card"
          @click="openTemplate(template)"
        >
          <header>
            <span class="card-icon"><v-icon icon="mdi-file-tree-outline" size="22" /></span>
            <div>
              <h3>{{ template.serviceType }}</h3>
              <p>{{ template.description || 'No description added yet.' }}</p>
            </div>
            <v-menu location="bottom end" @click.stop>
              <template #activator="{ props: menuProps }"
                ><v-btn
                  v-bind="menuProps"
                  icon="mdi-dots-horizontal"
                  variant="text"
                  size="small"
                  aria-label="Template actions"
              /></template>
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-content-copy"
                  title="Duplicate"
                  @click="duplicateTemplate(template)"
                />
                <v-list-item
                  prepend-icon="mdi-delete-outline"
                  title="Delete"
                  base-color="error"
                  @click="deleteTemplate(template)"
                />
              </v-list>
            </v-menu>
          </header>
          <div class="card-meta">
            <span
              ><v-icon icon="mdi-format-list-numbered" size="16" />{{
                serviceItemCount(template)
              }}
              order items</span
            >
            <span
              ><v-icon icon="mdi-account-multiple-outline" size="16" />{{
                roleCount(template)
              }}
              additional roles</span
            >
          </div>
          <footer>
            <div class="default-types">
              <template v-if="effectiveDefaultTypes(template).length">
                <span v-for="type in effectiveDefaultTypes(template)" :key="type">{{ type }}</span>
              </template>
              <small v-else>Not a default</small>
            </div>
            <v-icon icon="mdi-arrow-right" size="19" />
          </footer>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.templates-page {
  max-width: 1260px;
  margin: 0 auto;
  padding: 30px 34px 54px;
}
.templates-hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}
.back-button {
  margin: 0 0 18px -12px;
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
  font-size: 2rem;
  line-height: 1.1;
}
.templates-hero p {
  max-width: 680px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
}
.hero-count {
  display: flex;
  min-width: 112px;
  flex-direction: column;
  padding: 14px 18px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.72);
}
.hero-count strong {
  color: rgb(var(--v-theme-primary));
  font-size: 1.45rem;
}
.hero-count span {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
}
.template-directory {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 14px;
  background: rgba(var(--v-theme-surface), 0.68);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.07);
}
.directory-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 19px 21px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.directory-toolbar h2 {
  margin: 0;
  font-size: 1rem;
}
.directory-toolbar p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
}
.toolbar-actions {
  display: grid;
  min-width: min(470px, 50vw);
  grid-template-columns: minmax(210px, 1fr) auto;
  gap: 10px;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
  padding: 17px;
}
.template-card {
  padding: 17px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 11px;
  background: rgba(var(--v-theme-background), 0.2);
  cursor: pointer;
  transition: 0.15s ease;
}
.template-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.07);
}
.template-card header {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 11px;
  align-items: start;
}
.card-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.template-card h3 {
  margin: 1px 0 4px;
  font-size: 0.95rem;
}
.template-card header p {
  display: -webkit-box;
  min-height: 34px;
  margin: 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 16px 0;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.69rem;
}
.card-meta span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.template-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgb(var(--v-theme-primary));
}
.default-types {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.default-types span {
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.09);
  font-size: 0.62rem;
}
.default-types small {
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.64rem;
}
.empty-state {
  display: flex;
  min-height: 380px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
}
.empty-state > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.empty-state h2 {
  margin: 15px 0 5px;
  font-size: 1rem;
}
.empty-state p {
  margin: 0 0 18px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.75rem;
}
@media (max-width: 800px) {
  .templates-page {
    padding: 22px 18px 40px;
  }
  .templates-hero {
    align-items: start;
  }
  .hero-count {
    display: none;
  }
  .directory-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar-actions {
    min-width: 0;
    grid-template-columns: 1fr;
  }
  .template-grid {
    grid-template-columns: 1fr;
  }
}
</style>
