<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useConfirmDialogStore } from '@/stores/confirmDialog'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import type { ApiBibleCatalogEntry } from '@/adapters/types'

const { librarySettings, machineSettings } = storeToRefs(useSettingsStore())
const confirmDialog = useConfirmDialogStore()

// KJV is bundled (always resolvable, no config). ESV and api.bible editions (e.g. NIV) each
// need their own API key, entered below and stored per-machine in MachineSettings (never
// synced — see models/settings.ts) since a key is only meaningful on the machine it's
// configured on. `availableTranslationEntries` below is built from exactly the same rules
// commands::scripture::list_scripture_translations uses on the Rust side, so this list can
// never show something as "available" that the real picker wouldn't also offer.
const ESV_COPYRIGHT_NOTICE =
  'Scripture quotations marked (ESV) are from the ESV® Bible (The Holy Bible, English Standard Version®), copyright © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. www.esv.org'
const esvAvailable = ref(false)

const apiBibleCatalog = ref<ApiBibleCatalogEntry[]>([])
const loadingApiBibleCatalog = ref(false)
const pickedCatalogEntry = ref<ApiBibleCatalogEntry>()
let catalogLoadedForKey = ''

async function loadApiBibleCatalog() {
  const key = machineSettings.value?.apiBibleKey
  // Pass the draft key directly rather than relying on the Rust side re-reading
  // machine-settings.json — that file only has last Save's value, so without this the catalog
  // would silently fail to load until Save was pressed at least once.
  if (!key || catalogLoadedForKey === key || loadingApiBibleCatalog.value) return
  loadingApiBibleCatalog.value = true
  try {
    const catalog = await getAdapter().scripture.listApiBibleCatalog(key)
    // Defensive: api.bible's own id is the only field guaranteed unique — several editions
    // share an identical name/abbreviation (see catalogItemTitle below), so de-dupe on id
    // rather than trusting the response (or an overlapping re-fetch) to never repeat one.
    const seen = new Set<string>()
    apiBibleCatalog.value = catalog.filter((entry) => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
    catalogLoadedForKey = key
  } catch (e) {
    console.error('Failed to list the api.bible catalog:', e)
  } finally {
    loadingApiBibleCatalog.value = false
  }
}

// Several api.bible editions share an identical name/abbreviation (e.g. four "World English
// Bible" entries — Protestant/Catholic/Orthodox/Ecumenical) — description is the only field
// that tells them apart, so it's appended whenever present rather than only showing the name.
function catalogItemTitle(entry: ApiBibleCatalogEntry): string {
  const base = `${entry.name} (${entry.abbreviation})`
  return entry.description ? `${base} — ${entry.description}` : base
}

const addTranslationError = ref('')
function addApiBibleTranslation() {
  if (!librarySettings.value || !pickedCatalogEntry.value) return
  const entry = pickedCatalogEntry.value
  addTranslationError.value = ''
  if (librarySettings.value.apiBibleTranslations.some((t) => t.bibleId === entry.id)) {
    addTranslationError.value = `${entry.name} is already added.`
    return
  }
  // api.bible abbreviations often carry a trailing edition year (e.g. "NIV11") — strip it for
  // a cleaner picker/live-slide code, falling back to the raw abbreviation if that leaves nothing.
  const code =
    entry.abbreviation.replace(/\d+$/, '').toUpperCase() || entry.abbreviation.toUpperCase()
  if (librarySettings.value.apiBibleTranslations.some((t) => t.code === code)) {
    addTranslationError.value = `"${code}" is already used by another translation — remove it first.`
    return
  }
  librarySettings.value.apiBibleTranslations.push({ code, label: entry.name, bibleId: entry.id })
  if (!librarySettings.value.defaultTranslationCode)
    librarySettings.value.defaultTranslationCode = code
  pickedCatalogEntry.value = undefined
}

async function removeApiBibleTranslation(code: string) {
  if (!librarySettings.value) return
  const index = librarySettings.value.apiBibleTranslations.findIndex((t) => t.code === code)
  if (index === -1) return
  const target = librarySettings.value.apiBibleTranslations[index]
  if (!(await confirmDialog.confirm(`Remove "${target.label}"?`, 'Remove'))) return
  if (!librarySettings.value) return
  librarySettings.value.apiBibleTranslations.splice(index, 1)
  const wasDefault = librarySettings.value.defaultTranslationCode === code
  if (wasDefault) librarySettings.value.defaultTranslationCode = 'KJV'
}

interface AvailableTranslationEntry {
  code: string
  name: string
  removable: boolean
  needsKey: boolean
}
const availableTranslationEntries = computed<AvailableTranslationEntry[]>(() => {
  const entries: AvailableTranslationEntry[] = [
    { code: 'KJV', name: 'King James Version', removable: false, needsKey: false },
  ]
  if (esvAvailable.value) {
    entries.push({
      code: 'ESV',
      name: 'English Standard Version',
      removable: false,
      needsKey: false,
    })
  }
  const apiBibleKeyConfigured = !!machineSettings.value?.apiBibleKey
  for (const t of librarySettings.value?.apiBibleTranslations ?? []) {
    entries.push({ code: t.code, name: t.label, removable: true, needsKey: !apiBibleKeyConfigured })
  }
  return entries
})

function translationSource(entry: AvailableTranslationEntry): string {
  if (entry.code === 'KJV') return 'Included with Worship Studio'
  if (entry.code === 'ESV') return 'Connected through the ESV API'
  return 'Connected through api.bible'
}

// Whether the ESV copyright notice below needs to show is a question of whether ESV is
// actually resolvable right now (an esvApiKey configured on this machine — see
// commands::scripture on the Rust side), which can lag one Save behind the draft key typed
// into the field below. Exposed so SettingsView.vue's saveSettings() can re-run this right
// after a successful save (same pattern as CanvaSection.vue's loadCanvaStatus) — without it,
// the "Save Settings to verify this key" warning below would stay stuck until the whole page
// reloaded, since onMounted only ever runs once per component instance.
async function refreshAvailability() {
  try {
    const translations = await getAdapter().scripture.listTranslations()
    esvAvailable.value = translations.some((t) => t.code === 'ESV')
  } catch (e) {
    console.error('Failed to list scripture translations:', e)
  }
}
onMounted(refreshAvailability)
defineExpose({ refreshAvailability })
</script>

<template>
  <!-- Single root element required so the parent's v-show can toggle this section's visibility
       (v-show can't attach to a multi-root/fragment component). -->
  <div>
    <SettingsPanel
      title="English Standard Version"
      description="Connect an api.esv.org account to make the ESV available on this computer."
      icon="mdi-key-outline"
    >
      <v-text-field
        v-model="machineSettings!.esvApiKey"
        label="ESV API key"
        type="password"
        variant="outlined"
        density="compact"
        autocomplete="off"
        hint="Free account at api.esv.org."
        persistent-hint
        class="settings-form-field mb-3"
      />
      <v-alert v-if="esvAvailable" type="success" variant="tonal" density="compact">
        {{ ESV_COPYRIGHT_NOTICE }}
      </v-alert>
      <v-alert
        v-else-if="machineSettings!.esvApiKey"
        type="warning"
        variant="tonal"
        density="compact"
      >
        Save Settings to verify this key.
      </v-alert>
      <p v-else class="settings-muted">Not configured on this machine.</p>
    </SettingsPanel>

    <SettingsPanel
      title="Additional Bible editions"
      description="Use api.bible to add NIV and other licensed translations to the library."
      icon="mdi-book-plus-outline"
    >
      <v-text-field
        v-model="machineSettings!.apiBibleKey"
        label="api.bible API key"
        type="password"
        variant="outlined"
        density="compact"
        autocomplete="off"
        hint="Free account at scripture.api.bible."
        persistent-hint
        class="settings-form-field mb-3"
      />
      <div v-if="machineSettings!.apiBibleKey">
        <div class="translation-picker">
          <v-autocomplete
            v-model="pickedCatalogEntry"
            :items="apiBibleCatalog"
            :loading="loadingApiBibleCatalog"
            :item-title="catalogItemTitle"
            item-value="id"
            return-object
            label="Add a translation…"
            variant="outlined"
            density="compact"
            hide-details
            @update:focused="(focused: boolean) => focused && loadApiBibleCatalog()"
          />
          <v-btn
            variant="flat"
            color="primary"
            prepend-icon="mdi-plus"
            :disabled="!pickedCatalogEntry"
            @click="addApiBibleTranslation"
          >
            Add
          </v-btn>
        </div>
        <p v-if="addTranslationError" class="text-caption text-error mt-2">
          {{ addTranslationError }}
        </p>
      </div>
      <p v-else class="settings-muted">Not configured on this machine.</p>
    </SettingsPanel>

    <SettingsPanel
      title="Available translations"
      description="Choose the default used for new passages. Operators can still switch translations live."
      icon="mdi-book-open-page-variant-outline"
    >
      <div class="translation-grid" role="radiogroup" aria-label="Default Bible translation">
        <article
          v-for="entry in availableTranslationEntries"
          :key="entry.code"
          class="translation-card"
          :class="{
            'translation-card--selected': librarySettings!.defaultTranslationCode === entry.code,
          }"
          role="radio"
          :aria-checked="librarySettings!.defaultTranslationCode === entry.code"
          tabindex="0"
          @click="librarySettings!.defaultTranslationCode = entry.code"
          @keydown.enter="librarySettings!.defaultTranslationCode = entry.code"
          @keydown.space.prevent="librarySettings!.defaultTranslationCode = entry.code"
        >
          <header>
            <span class="translation-code">{{ entry.code }}</span>
            <v-icon
              v-if="librarySettings!.defaultTranslationCode === entry.code"
              icon="mdi-check-circle"
              color="primary"
              size="19"
            />
          </header>
          <h3>{{ entry.name }}</h3>
          <p>{{ translationSource(entry) }}</p>
          <footer>
            <span v-if="entry.needsKey" class="translation-warning">
              <v-icon icon="mdi-alert-circle-outline" size="15" /> API key needed
            </span>
            <span
              v-else-if="librarySettings!.defaultTranslationCode === entry.code"
              class="translation-default"
            >
              <v-icon icon="mdi-check-circle" size="15" /> Default
            </span>
            <span v-else class="translation-available">Available</span>
            <span class="translation-card-actions">
              <span
                v-if="librarySettings!.defaultTranslationCode !== entry.code"
                class="translation-set-default"
                >Make default</span
              >
              <v-btn
                v-if="entry.removable"
                icon="mdi-delete-outline"
                variant="text"
                color="error"
                size="small"
                class="translation-remove"
                :aria-label="`Remove ${entry.name}`"
                @click.stop="removeApiBibleTranslation(entry.code)"
              />
            </span>
          </footer>
        </article>
      </div>
    </SettingsPanel>
  </div>
</template>

<style scoped>
.settings-form-field {
  max-width: 520px;
}
.settings-muted {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.69rem;
  line-height: 1.45;
}
.translation-picker {
  display: grid;
  grid-template-columns: minmax(0, 420px) auto;
  align-items: center;
  gap: 12px;
}
.translation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 11px;
}
.translation-card {
  display: flex;
  min-height: 154px;
  flex-direction: column;
  padding: 15px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.2);
  cursor: pointer;
  outline: none;
  transition: 0.15s ease;
}
.translation-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.3);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.06);
}
.translation-card:focus-visible {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.45);
}
.translation-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.065);
}
.translation-card header,
.translation-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.translation-code {
  display: inline-flex;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  font-size: 0.64rem;
  font-weight: 750;
  letter-spacing: 0.04em;
}
.translation-card h3 {
  margin: 13px 0 3px;
  font-size: 0.84rem;
  line-height: 1.35;
}
.translation-card > p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.68rem;
  line-height: 1.4;
}
.translation-card footer {
  min-height: 28px;
  margin-top: auto;
  padding-top: 13px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  font-size: 0.66rem;
}
.translation-default,
.translation-warning {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
}
.translation-default,
.translation-set-default {
  color: rgb(var(--v-theme-primary));
}
.translation-warning {
  color: rgb(var(--v-theme-warning));
}
.translation-available {
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.translation-set-default {
  font-weight: 650;
}
.translation-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.translation-remove {
  margin: -6px -7px -6px 0;
}
@media (max-width: 700px) {
  .translation-picker {
    align-items: stretch;
    grid-template-columns: 1fr;
  }
}
</style>
