<script setup lang="ts">
defineProps<{
  previousDisabled: boolean
  nextDisabled: boolean
  prevPreviewLabel: string
  nextPreviewLabel: string
  isPresenting: boolean
  currentSlideLabel: string
  liveContextSnippet: string
  slidePositionLabel: string
  backgroundOnly: boolean
  backgroundOnlyDisabled: boolean
  isBlankScreen: boolean
}>()
defineEmits<{
  previous: []
  next: []
  'toggle-background-only': []
  'toggle-blank-screen': []
}>()
</script>

<template>
  <div class="live-footer">
    <button
      type="button"
      class="transport-destination transport-destination--previous"
      :disabled="previousDisabled"
      @click="$emit('previous')"
    >
      <v-icon icon="mdi-chevron-left" size="25" />
      <span class="destination-copy">
        <small>Previous</small>
        <strong>{{ prevPreviewLabel }}</strong>
      </span>
      <kbd>←</kbd>
    </button>

    <div class="transport-center">
      <div class="transport-current">
        <span class="transport-mode" :class="{ 'transport-mode--live': isPresenting }">
          <i />{{ isPresenting ? 'Live' : 'Preview' }}
        </span>
        <div class="current-slide-copy">
          <strong>{{ currentSlideLabel }}</strong>
          <span v-if="liveContextSnippet">{{ liveContextSnippet }}</span>
        </div>
        <span class="slide-position">{{ slidePositionLabel }}</span>
      </div>
      <div class="screen-overrides" aria-label="Screen overrides">
        <v-btn
          :variant="backgroundOnly ? 'flat' : 'tonal'"
          :color="backgroundOnly ? 'primary' : undefined"
          prepend-icon="mdi-image-outline"
          size="small"
          :disabled="backgroundOnlyDisabled"
          class="screen-override-button"
          @click="$emit('toggle-background-only')"
        >
          Background Only <kbd>G</kbd>
        </v-btn>
        <v-btn
          :variant="isBlankScreen ? 'flat' : 'tonal'"
          :color="isBlankScreen ? 'primary' : undefined"
          prepend-icon="mdi-monitor-off"
          size="small"
          class="screen-override-button"
          :aria-pressed="isBlankScreen"
          @click="$emit('toggle-blank-screen')"
        >
          {{ isBlankScreen ? 'Restore Screen' : 'Blank Screen' }} <kbd>B</kbd>
        </v-btn>
      </div>
    </div>

    <button
      type="button"
      class="transport-destination transport-destination--next"
      :disabled="nextDisabled"
      @click="$emit('next')"
    >
      <kbd>→</kbd>
      <span class="destination-copy">
        <small>Next</small>
        <strong>{{ nextPreviewLabel }}</strong>
      </span>
      <v-icon icon="mdi-chevron-right" size="25" />
    </button>
  </div>
</template>

<style scoped>
.live-footer {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(390px, 1.35fr) minmax(220px, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 82px;
  padding: 9px 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-surface), 0.98),
    rgba(var(--v-theme-surface-variant), 0.48)
  );
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.08);
}
.transport-destination {
  display: grid;
  min-width: 0;
  min-height: 58px;
  grid-template-columns: 28px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 8px;
  background: rgba(var(--v-theme-background), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    color var(--ws-transition-fast);
}
.transport-destination:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.065);
  color: rgba(var(--v-theme-on-surface), 0.94);
}
.transport-destination:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: 1px;
}
.transport-destination:disabled {
  cursor: default;
  opacity: 0.42;
}
.transport-destination--next {
  border-color: rgba(var(--v-theme-primary), 0.18);
  background: rgba(var(--v-theme-primary), 0.08);
}
.transport-destination--next .destination-copy {
  text-align: right;
}
.destination-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.destination-copy small {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-size: 0.61rem;
  font-weight: 720;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}
.destination-copy strong {
  overflow: hidden;
  color: inherit;
  font-size: 0.72rem;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-footer kbd {
  display: inline-grid;
  min-width: 24px;
  height: 24px;
  place-items: center;
  padding: 0 5px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-bottom-color: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-family: inherit;
  font-size: 0.66rem;
  font-weight: 650;
  line-height: 1;
}
.transport-center {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 11px;
}
.transport-current {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}
.transport-mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border: 1px solid rgba(var(--v-theme-slate), 0.22);
  border-radius: 5px;
  background: rgba(var(--v-theme-slate), 0.09);
  color: rgb(var(--v-theme-slate));
  font-size: 0.61rem;
  font-weight: 760;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.transport-mode i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.transport-mode--live {
  border-color: rgba(var(--v-theme-error), 0.28);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.transport-mode--live i {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.12);
}
.current-slide-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}
.current-slide-copy strong,
.current-slide-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.current-slide-copy strong {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.78rem;
  font-weight: 680;
}
.current-slide-copy span {
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.67rem;
}
.slide-position {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.screen-overrides {
  display: grid;
  flex: none;
  gap: 4px;
}
.screen-override-button {
  justify-content: flex-start;
  width: 100%;
  flex: none;
  padding-inline-end: 6px;
  font-size: 0.67rem;
  letter-spacing: 0;
  text-transform: none;
}
.screen-override-button :deep(.v-btn__content) {
  min-width: 0;
  flex: 1;
  justify-content: flex-start;
  gap: 10px;
}
.screen-override-button kbd {
  min-width: 20px;
  height: 20px;
  margin-left: auto;
  font-size: 0.6rem;
}
@media (max-width: 1250px) {
  .live-footer {
    grid-template-columns: minmax(190px, 0.9fr) minmax(330px, 1.2fr) minmax(190px, 0.9fr);
    gap: 8px;
    padding-right: 10px;
    padding-left: 10px;
  }
  .transport-destination > kbd,
  .slide-position {
    display: none;
  }
  .transport-destination--previous {
    grid-template-columns: 28px minmax(0, 1fr);
  }
  .transport-destination--next {
    grid-template-columns: minmax(0, 1fr) 28px;
  }
}
</style>
