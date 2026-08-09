<script setup lang="ts">
import type { DisplayInfo } from '@/adapters/types'

defineProps<{
  modelValue: boolean
  displays: DisplayInfo[]
  loading: boolean
  error: string
  selectedDisplayId: string
}>()
defineEmits<{
  'update:modelValue': [boolean]
  'update:selectedDisplayId': [string]
  identify: [string]
  refresh: []
  'use-and-start': []
}>()
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="650"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card class="presentation-display-dialog">
      <v-card-title class="presentation-display-title">
        <div>
          <span><v-icon icon="mdi-monitor-arrow-down" size="21" /></span>
          <div>
            <strong>Choose Audience Display</strong>
            <small>Select where the congregation should see the presentation.</small>
          </div>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Close display setup"
          @click="$emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text class="presentation-display-content">
        <v-alert
          v-if="displays.length <= 1 && !loading"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          Connect the projector and set Windows to <strong>Extend</strong>, then detect displays
          again. Mirrored displays cannot keep the operator view private.
        </v-alert>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">
          {{ error }}
        </v-alert>
        <div v-if="loading" class="presentation-display-loading">
          <v-progress-circular indeterminate color="primary" size="28" />
          <span>Detecting connected displays…</span>
        </div>
        <div v-else class="presentation-display-list" role="radiogroup">
          <article
            v-for="display in displays"
            :key="display.id"
            class="presentation-display-option"
            :class="{
              selected: selectedDisplayId === display.id,
              disabled: display.role === 'operator',
            }"
            :tabindex="display.role === 'operator' ? -1 : 0"
            role="radio"
            :aria-checked="selectedDisplayId === display.id"
            :aria-disabled="display.role === 'operator'"
            @click="display.role !== 'operator' && $emit('update:selectedDisplayId', display.id)"
            @keydown.enter="
              display.role !== 'operator' && $emit('update:selectedDisplayId', display.id)
            "
            @keydown.space.prevent="
              display.role !== 'operator' && $emit('update:selectedDisplayId', display.id)
            "
          >
            <span class="presentation-display-icon">
              <v-icon
                :icon="display.role === 'operator' ? 'mdi-monitor-dashboard' : 'mdi-projector'"
                size="22"
              />
            </span>
            <div class="presentation-display-copy">
              <strong>{{ display.name }}</strong>
              <span>{{ display.resolution }}</span>
            </div>
            <span class="presentation-display-role">
              {{
                display.role === 'operator'
                  ? 'Operator'
                  : display.role === 'audience'
                    ? 'Audience'
                    : 'Available'
              }}
            </span>
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-numeric"
              @click.stop="$emit('identify', display.id)"
            >
              Identify
            </v-btn>
            <v-icon
              :icon="
                selectedDisplayId === display.id ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'
              "
              :color="selectedDisplayId === display.id ? 'primary' : undefined"
              size="20"
            />
          </article>
          <div v-if="!displays.length" class="presentation-displays-empty">
            <v-icon icon="mdi-monitor-off" size="27" />
            <span>No displays were detected.</span>
          </div>
        </div>
      </v-card-text>
      <v-card-actions class="presentation-display-actions">
        <v-btn
          variant="text"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="$emit('refresh')"
        >
          Detect Again
        </v-btn>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-play"
          :loading="loading"
          :disabled="!selectedDisplayId"
          @click="$emit('use-and-start')"
        >
          Use Display & Start
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.presentation-display-dialog {
  overflow: hidden;
}
.presentation-display-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.presentation-display-title > div,
.presentation-display-title > div > span {
  display: flex;
  align-items: center;
}
.presentation-display-title > div {
  gap: 10px;
}
.presentation-display-title > div > span {
  width: 38px;
  height: 38px;
  justify-content: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.presentation-display-title > div > div {
  display: flex;
  flex-direction: column;
}
.presentation-display-title strong {
  font-size: 0.86rem;
}
.presentation-display-title small {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.67rem;
}
.presentation-display-content {
  padding: 17px !important;
}
.presentation-display-loading,
.presentation-displays-empty {
  display: flex;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
}
.presentation-display-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.presentation-display-option {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto auto 24px;
  align-items: center;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.2);
  cursor: pointer;
  outline: none;
}
.presentation-display-option:hover:not(.disabled),
.presentation-display-option:focus-visible:not(.disabled) {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.045);
}
.presentation-display-option.selected {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.075);
}
.presentation-display-option.disabled {
  cursor: default;
  opacity: 0.58;
}
.presentation-display-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-primary));
}
.presentation-display-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.presentation-display-copy strong {
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.presentation-display-copy span,
.presentation-display-role {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.64rem;
}
.presentation-display-role {
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-weight: 650;
}
.presentation-display-actions {
  padding: 11px 15px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
</style>
