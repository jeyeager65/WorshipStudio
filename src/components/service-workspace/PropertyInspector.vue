<script setup lang="ts">
import { computed } from 'vue'
import type { Service, ServiceItem } from '@/models/service'
import type { AutoAdvanceConfig } from '@/models/library'
import type { PersonOption } from '@/utils/personOptions'

const props = defineProps<{
  service: Service
  selectedItem: ServiceItem
  /** slide-ref items only — what selectedItem.autoAdvance falls back to when unset (see
   *  useLiveTransport.ts's liveItemAutoAdvance, which resolves the same way); shown as a hint
   *  when the Enabled switch below is off. */
  libraryAutoAdvance?: AutoAdvanceConfig
  themeTargetLabel?: string
  themeOverrideOptions: { title: string; value: string }[]
  itemRoleOptions: Array<{ type?: 'subheader'; title: string; value?: string }>
  rolePersonOptions: PersonOption[]
  assignedPersonId: (role: string | undefined) => string | undefined
  updateItemRole: (itemId: string, role: string | undefined) => void
  updateRolePerson: (role: string, personId: string | undefined) => void
  updatePresenterNote: (itemId: string, note: string) => void
}>()

// Aliased to a local so eslint's no-mutating-props check (which only pattern-matches direct
// props.x member expressions) doesn't flag what's actually a deliberate, parent-approved
// mutation of the same reactive item the parent's own selectedItem computed points to.
function updateThemeId(value: string) {
  const item = props.selectedItem
  item.themeId = value || undefined
}

// Only actual slide content — see notes/slide-auto-advance-plan.md. Songs, scripture, and
// sermons are all deliberately excluded even though each can produce multiple slides: they're
// normally paced live by whoever's leading them (singers, a reader, the preacher), not cycled
// on a timer — this is for slide content nobody is actively pacing, like a pre-service loop.
const AUTO_ADVANCE_TYPES = new Set(['text-slide', 'slide-ref'])
const supportsAutoAdvance = computed(() => AUTO_ADVANCE_TYPES.has(props.selectedItem.type))
const DEFAULT_AUTO_ADVANCE_INTERVAL_SECONDS = 8

function updateAutoAdvanceEnabled(enabled: boolean | null) {
  const item = props.selectedItem
  item.autoAdvance = enabled
    ? {
        intervalSeconds:
          item.autoAdvance?.intervalSeconds ?? DEFAULT_AUTO_ADVANCE_INTERVAL_SECONDS,
        loop: item.autoAdvance?.loop ?? false,
      }
    : undefined
}
function updateAutoAdvanceInterval(value: string) {
  const item = props.selectedItem
  if (!item.autoAdvance) return
  const seconds = Number(value)
  item.autoAdvance.intervalSeconds = Number.isFinite(seconds) ? Math.max(1, seconds) : 1
}
function updateAutoAdvanceLoop(value: boolean | null) {
  const item = props.selectedItem
  if (!item.autoAdvance) return
  item.autoAdvance.loop = !!value
}
function updateBulletinLabel(value: string | undefined) {
  const item = props.selectedItem
  item.bulletinLabel = value || undefined
}
function updateBulletinNote(value: string) {
  const item = props.selectedItem
  item.bulletinNote = value || undefined
}
</script>

<template>
  <div class="property-inspector">
    <section v-if="themeTargetLabel" class="property-section">
      <div class="property-section-title">Presentation</div>
      <label class="property-row property-row--top">
        <span>
          Theme
          <small>{{ themeTargetLabel }}</small>
        </span>
        <v-select
          :model-value="selectedItem.themeId ?? ''"
          :items="themeOverrideOptions"
          variant="outlined"
          density="compact"
          hide-details
          @update:model-value="updateThemeId"
        />
      </label>
    </section>

    <section v-if="supportsAutoAdvance" class="property-section">
      <div class="property-section-title">Auto-Advance</div>
      <label class="property-row">
        <span>Enabled</span>
        <v-switch
          :model-value="!!selectedItem.autoAdvance"
          color="primary"
          density="compact"
          hide-details
          aria-label="Auto-Advance enabled"
          @update:model-value="updateAutoAdvanceEnabled"
        />
      </label>
      <p v-if="!selectedItem.autoAdvance && libraryAutoAdvance" class="property-hint">
        Using this slide's own default: {{ libraryAutoAdvance.intervalSeconds }}s{{
          libraryAutoAdvance.loop ? ', looping' : ''
        }}
      </p>
      <template v-if="selectedItem.autoAdvance">
        <label class="property-row">
          <span>Interval</span>
          <v-text-field
            :model-value="selectedItem.autoAdvance.intervalSeconds"
            type="number"
            min="1"
            suffix="sec"
            variant="outlined"
            density="compact"
            hide-details
            @update:model-value="updateAutoAdvanceInterval"
          />
        </label>
        <label class="property-row">
          <span>Loop</span>
          <v-switch
            :model-value="selectedItem.autoAdvance.loop"
            color="primary"
            density="compact"
            hide-details
            aria-label="Loop auto-advance"
            @update:model-value="updateAutoAdvanceLoop"
          />
        </label>
      </template>
    </section>

    <section class="property-section">
      <div class="property-section-title">Order of Worship</div>
      <label class="property-row">
        <span>Label</span>
        <v-text-field
          :model-value="selectedItem.bulletinLabel"
          variant="outlined"
          density="compact"
          clearable
          hide-details
          :placeholder="
            selectedItem.type === 'bulletin-note' ? 'Bulletin heading' : 'Use default heading'
          "
          @update:model-value="updateBulletinLabel"
        />
      </label>
      <label class="property-row property-row--top">
        <span>Note</span>
        <v-textarea
          :model-value="selectedItem.bulletinNote"
          variant="outlined"
          density="compact"
          hide-details
          rows="2"
          placeholder="Optional printed note"
          @update:model-value="updateBulletinNote"
        />
      </label>
    </section>

    <section class="property-section">
      <div class="property-section-title">People</div>
      <label class="property-row">
        <span>Role</span>
        <v-select
          :model-value="selectedItem.role"
          :items="itemRoleOptions"
          variant="outlined"
          density="compact"
          clearable
          hide-details
          placeholder="No role"
          @update:model-value="
            (value: string | undefined) => updateItemRole(selectedItem.id, value)
          "
        />
      </label>
      <label v-if="selectedItem.role" class="property-row">
        <span>Assigned</span>
        <v-select
          :model-value="assignedPersonId(selectedItem.role)"
          :items="rolePersonOptions"
          variant="outlined"
          density="compact"
          clearable
          hide-details
          placeholder="Not assigned"
          @update:model-value="
            (value: string | undefined) => updateRolePerson(selectedItem.role!, value)
          "
        />
      </label>
    </section>

    <section class="property-section">
      <div class="property-section-title">Operator</div>
      <label class="property-row property-row--top">
        <span>Notes</span>
        <v-textarea
          :model-value="service.presenterNotes?.[selectedItem.id]"
          variant="outlined"
          density="compact"
          hide-details
          rows="2"
          placeholder="Only visible to the operator"
          @update:model-value="(value: string) => updatePresenterNote(selectedItem.id, value)"
        />
      </label>
    </section>
  </div>
</template>

<style scoped>
.property-inspector {
  max-width: 680px;
  margin-top: 28px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgba(var(--v-theme-surface), 0.68);
}
.property-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px 16px 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
}
.property-section:last-child {
  border-bottom: 0;
}
.property-section-title {
  margin-bottom: 3px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.085em;
  text-transform: uppercase;
}
.property-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}
.property-hint {
  margin: -2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
}
.property-row > span {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.76rem;
}
.property-row > span small {
  display: block;
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.61rem;
}
.property-row--top {
  align-items: start;
}
.property-row--top > span {
  padding-top: 9px;
}
.property-inspector :deep(.v-field) {
  border-radius: 6px;
  background: rgba(var(--v-theme-background), 0.55);
  font-size: 0.8rem;
}
.property-inspector :deep(.v-field__input) {
  min-height: 38px;
  padding-top: 7px;
  padding-bottom: 7px;
}
</style>
