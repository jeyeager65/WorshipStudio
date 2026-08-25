<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useServiceTemplatesStore } from '@/stores/serviceTemplates'
import { useServiceTypesStore } from '@/stores/serviceTypes'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import AsyncLoadState from '@/components/AsyncLoadState.vue'
import type { ServiceTemplate } from '@/models/service'

const router = useRouter()
const serviceTemplatesStore = useServiceTemplatesStore()
const serviceTypesStore = useServiceTypesStore()
const confirmDialog = useConfirmDialogStore()
const searchQuery = ref('')

onMounted(() => {
  serviceTemplatesStore.load()
  serviceTypesStore.load()
})

const templates = computed(() => serviceTemplatesStore.serviceTemplates)

function effectiveDefaultTypeNames(template: ServiceTemplate): string[] {
  return (template.defaultForServiceTypeIds ?? []).map(
    (id) => serviceTypesStore.serviceTypes.find((type) => type.id === id)?.name ?? id,
  )
}

const filteredTemplates = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return [...templates.value]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (template) =>
        !query ||
        template.name.toLowerCase().includes(query) ||
        template.description?.toLowerCase().includes(query) ||
        effectiveDefaultTypeNames(template).some((name) => name.toLowerCase().includes(query)),
    )
})

function serviceItemCount(template: ServiceTemplate): number {
  return template.items.filter((item) => item.kind !== 'role-only').length
}

function roleCount(template: ServiceTemplate): number {
  return template.items.filter((item) => item.kind === 'role-only').length
}

function openTemplate(template: ServiceTemplate) {
  void router.push({
    name: 'service-template-editor',
    params: { templateId: template.id },
  })
}

function createTemplate() {
  void router.push({ name: 'service-template-new' })
}

async function duplicateTemplate(template: ServiceTemplate) {
  const baseName = `${template.name} Copy`
  let name = baseName
  let suffix = 2
  while (templates.value.some((candidate) => candidate.name.toLowerCase() === name.toLowerCase())) {
    name = `${baseName} ${suffix++}`
  }
  const duplicate: ServiceTemplate = {
    ...structuredClone(toRaw(template)),
    id: `template-${crypto.randomUUID()}`,
    name,
    description: template.description
      ? `Copy of ${template.name}. ${template.description}`
      : `Copy of ${template.name}.`,
    defaultForServiceTypeIds: [],
    items: template.items.map((item) => ({
      ...structuredClone(toRaw(item)),
      id: `template-item-${crypto.randomUUID()}`,
    })),
  }
  await serviceTemplatesStore.save(duplicate)
  openTemplate(duplicate)
}

async function deleteTemplate(template: ServiceTemplate) {
  if (!(await confirmDialog.confirm(`Delete the "${template.name}" template?`, 'Delete'))) return
  await serviceTemplatesStore.remove(template.id)
}
</script>

<template>
  <main class="templates-page app-page">
    <header class="templates-hero app-page-hero">
      <div>
        <div class="page-eyebrow">Service Planning</div>
        <h1>Service Templates</h1>
        <p>
          Build reusable starting points for service orders, staffing, and service-type defaults.
        </p>
      </div>
      <div class="templates-summary" aria-label="Service template summary">
        <div class="summary-stat">
          <strong>{{ templates.length }}</strong>
          <span>Templates</span>
        </div>
      </div>
    </header>

    <section class="template-directory app-page-body">
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
          <v-btn
            color="primary"
            variant="flat"
            prepend-icon="mdi-plus"
            class="app-icon-btn"
            aria-label="New Template"
            @click="createTemplate"
            ><span class="app-btn-label">New Template</span></v-btn
          >
        </div>
      </div>

      <AsyncLoadState
        v-if="!serviceTemplatesStore.loaded"
        :loading="serviceTemplatesStore.loading"
        :error="serviceTemplatesStore.loadError"
        label="service templates"
        @retry="serviceTemplatesStore.load"
      />
      <AsyncLoadState
        v-if="serviceTemplatesStore.loaded && serviceTemplatesStore.loadError"
        :loading="false"
        :error="serviceTemplatesStore.loadError"
        label="updated service templates"
        compact
        class="mb-3"
        @retry="serviceTemplatesStore.load"
      />
      <v-alert
        v-if="serviceTemplatesStore.mutationError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        Could not save template changes: {{ serviceTemplatesStore.mutationError }}
      </v-alert>
      <div v-if="serviceTemplatesStore.loaded && templates.length === 0" class="empty-state">
        <span><v-icon icon="mdi-file-tree-outline" size="30" /></span>
        <h2>No Service Templates Yet</h2>
        <p>Create a reusable order and staffing plan for your first service type.</p>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" @click="createTemplate"
          >New Template</v-btn
        >
      </div>
      <div
        v-else-if="serviceTemplatesStore.loaded && filteredTemplates.length === 0"
        class="empty-state"
      >
        <span><v-icon icon="mdi-file-search-outline" size="30" /></span>
        <h2>No Matching Templates</h2>
        <p>Try a different name, description, or service type.</p>
      </div>
      <div v-else-if="serviceTemplatesStore.loaded" class="template-grid app-page-scroll">
        <article
          v-for="template in filteredTemplates"
          :key="template.id"
          class="template-card"
          @click="openTemplate(template)"
        >
          <header>
            <span class="card-icon"><v-icon icon="mdi-file-tree-outline" size="22" /></span>
            <div>
              <h3>{{ template.name }}</h3>
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
              <template v-if="effectiveDefaultTypeNames(template).length">
                <span v-for="(name, index) in effectiveDefaultTypeNames(template)" :key="index">{{
                  name
                }}</span>
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
  padding: 24px clamp(24px, 3vw, 48px);
  background:
    radial-gradient(circle at 24% 0, rgba(var(--v-theme-slate), 0.055), transparent 420px),
    rgb(var(--v-theme-background));
}
/* width: 100% because the page is a flex column now (.app-page) — auto side margins on a flex
   item shrink it to its content width instead of filling the line. */
.templates-hero,
.template-directory {
  width: 100%;
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
}
.templates-hero {
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
  color: rgb(var(--v-theme-slate));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.templates-hero h1 {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
.templates-hero p {
  max-width: 620px;
  margin: 9px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
  line-height: 1.5;
}
.templates-summary {
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
  color: rgb(var(--v-theme-slate));
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
/* align-items: center because a grid's default `stretch` can't stretch the button — Vuetify gives
   v-btn a fixed height — so it fell back to the top of a row whose height came from the taller
   search field, leaving the two visibly out of line. */
.toolbar-actions {
  display: grid;
  min-width: min(470px, 50vw);
  align-items: center;
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
    align-items: stretch;
    flex-direction: column;
  }
  .templates-summary {
    align-self: flex-start;
  }
  /* Only the toolbar stacks (heading above the controls) — the controls stay a row so New
     Template keeps sitting beside the search rather than dropping to a full-width bar. */
  .directory-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }
  .toolbar-actions .v-input {
    flex: 1;
    min-width: 0;
  }
  .template-grid {
    grid-template-columns: 1fr;
  }
}
/* The whole hero card (eyebrow, title, description, stat) is nice-to-have context, not
   essential, and it eats space that matters more on a narrow/short screen. */
</style>
