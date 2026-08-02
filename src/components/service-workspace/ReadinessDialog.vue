<script setup lang="ts">
import type { ReadinessIssue, ServiceReadinessResult } from '@/utils/serviceReadiness'

defineProps<{
  modelValue: boolean
  readiness: ServiceReadinessResult
  color: string
  icon: string
}>()
defineEmits<{ 'update:modelValue': [boolean]; 'issue-selected': [ReadinessIssue] }>()
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="720" @update:model-value="$emit('update:modelValue', $event)">
    <v-card class="readiness-dialog-card">
      <v-card-title class="readiness-dialog-title">
        <span class="readiness-dialog-title-icon" :class="`is-${color}`">
          <v-icon :icon="icon" size="23" />
        </span>
        <span>
          <strong>{{ readiness.blockers.length ? 'Service Needs Attention' : 'Ready to Present' }}</strong>
          <small>
            {{ readiness.blockers.length }} blocker{{ readiness.blockers.length === 1 ? '' : 's' }}
            · {{ readiness.warnings.length }} warning{{ readiness.warnings.length === 1 ? '' : 's' }}
          </small>
        </span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="$emit('update:modelValue', false)" />
      </v-card-title>
      <v-card-text class="readiness-dialog-content">
        <div v-if="!readiness.issues.length" class="readiness-complete-state">
          <span><v-icon icon="mdi-check" size="28" /></span>
          <div>
            <strong>Everything required for presentation is available.</strong>
            <p>The check will update automatically if the service or display setup changes.</p>
          </div>
        </div>
        <template v-else>
          <section v-if="readiness.blockers.length" class="readiness-issue-section">
            <header>
              <span>Must fix before presenting</span>
              <strong>{{ readiness.blockers.length }}</strong>
            </header>
            <button
              v-for="issue in readiness.blockers"
              :key="issue.id"
              type="button"
              class="readiness-issue-row is-blocker"
              @click="$emit('issue-selected', issue)"
            >
              <span class="readiness-issue-icon"
                ><v-icon icon="mdi-alert-circle-outline" size="20"
              /></span>
              <span class="readiness-issue-copy">
                <strong>{{ issue.title }}</strong>
                <small>{{ issue.detail }}</small>
              </span>
              <span class="readiness-issue-action">
                {{
                  issue.action === 'display'
                    ? 'Choose display'
                    : issue.action === 'assignments'
                      ? 'Assignments'
                      : 'Open item'
                }}
                <v-icon icon="mdi-chevron-right" size="18" />
              </span>
            </button>
          </section>
          <section v-if="readiness.warnings.length" class="readiness-issue-section">
            <header>
              <span>Review before the service</span>
              <strong>{{ readiness.warnings.length }}</strong>
            </header>
            <button
              v-for="issue in readiness.warnings"
              :key="issue.id"
              type="button"
              class="readiness-issue-row is-warning"
              @click="$emit('issue-selected', issue)"
            >
              <span class="readiness-issue-icon"
                ><v-icon icon="mdi-alert-outline" size="20"
              /></span>
              <span class="readiness-issue-copy">
                <strong>{{ issue.title }}</strong>
                <small>{{ issue.detail }}</small>
              </span>
              <span class="readiness-issue-action">
                {{
                  issue.action === 'assignments'
                    ? 'Assignments'
                    : issue.action === 'library-health'
                      ? 'Library Health'
                      : 'Open item'
                }}
                <v-icon icon="mdi-chevron-right" size="18" />
              </span>
            </button>
          </section>
        </template>
      </v-card-text>
      <v-card-actions class="readiness-dialog-actions">
        <span>Updates automatically</span>
        <v-spacer />
        <v-btn variant="tonal" @click="$emit('update:modelValue', false)">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.readiness-dialog-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.11);
  background: rgb(var(--v-theme-surface));
}
.readiness-dialog-title {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  white-space: normal;
}
.readiness-dialog-title > span:nth-child(2) {
  display: grid;
  gap: 2px;
}
.readiness-dialog-title strong {
  font-size: 0.98rem;
  font-weight: 720;
}
.readiness-dialog-title small {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
}
.readiness-dialog-title-icon,
.readiness-complete-state > span {
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  place-items: center;
  border-radius: 10px;
}
.readiness-dialog-title-icon.is-error {
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
}
.readiness-dialog-title-icon.is-warning {
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}
.readiness-dialog-title-icon.is-success,
.readiness-complete-state > span {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.readiness-dialog-content {
  display: grid;
  max-height: min(620px, 70vh);
  gap: 18px;
  padding: 18px 20px !important;
  overflow-y: auto;
}
.readiness-complete-state {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid rgba(var(--v-theme-success), 0.22);
  border-radius: 10px;
  background: rgba(var(--v-theme-success), 0.055);
}
.readiness-complete-state strong {
  font-size: 0.84rem;
}
.readiness-complete-state p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.72rem;
}
.readiness-issue-section {
  display: grid;
  gap: 7px;
}
.readiness-issue-section > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 3px 3px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.65rem;
  font-weight: 720;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}
.readiness-issue-section > header strong {
  display: grid;
  min-width: 23px;
  height: 20px;
  place-items: center;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: 0.65rem;
}
.readiness-issue-row {
  display: grid;
  width: 100%;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.025);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.readiness-issue-row:hover {
  border-color: rgba(var(--v-theme-primary), 0.34);
  background: rgba(var(--v-theme-primary), 0.055);
}
.readiness-issue-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
}
.readiness-issue-row.is-blocker .readiness-issue-icon {
  background: rgba(var(--v-theme-error), 0.11);
  color: rgb(var(--v-theme-error));
}
.readiness-issue-row.is-warning .readiness-issue-icon {
  background: rgba(var(--v-theme-warning), 0.11);
  color: rgb(var(--v-theme-warning));
}
.readiness-issue-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.readiness-issue-copy strong {
  font-size: 0.78rem;
  font-weight: 680;
}
.readiness-issue-copy small {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.69rem;
  line-height: 1.4;
}
.readiness-issue-action {
  display: inline-flex;
  align-items: center;
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 680;
  white-space: nowrap;
}
.readiness-dialog-actions {
  padding: 11px 18px !important;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
}
.readiness-dialog-actions > span {
  color: rgba(var(--v-theme-on-surface), 0.44);
  font-size: 0.66rem;
}
@media (max-width: 620px) {
  .readiness-issue-row {
    grid-template-columns: 34px minmax(0, 1fr);
  }
  .readiness-issue-action {
    display: none;
  }
}
</style>
