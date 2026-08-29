<script setup lang="ts">
import { openHelpTopic } from '@/utils/openHelpTopic'

withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    tone?: 'default' | 'danger'
    /** A help-site topic slug (the same ones router/index.ts uses for meta.helpTopic). Given one,
     *  the header gets a help button on the right — the conventional place for "explain this
     *  section", and one line per panel rather than each inventing its own affordance in its
     *  body, where a control has to compete with whatever else is already there. */
    helpTopic?: string
  }>(),
  { title: '', description: '', icon: '', tone: 'default', helpTopic: '' },
)
</script>

<template>
  <section class="settings-panel" :class="{ 'settings-panel--danger': tone === 'danger' }">
    <header v-if="title || description || icon" class="settings-panel-heading">
      <span v-if="icon" class="settings-panel-icon"><v-icon :icon="icon" size="20" /></span>
      <div>
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.action || helpTopic" class="settings-panel-action">
        <slot name="action" />
        <!-- `title` rather than a v-tooltip: a tooltip activator is one of the touch-hostile
             patterns on iOS, and an aria-label already covers assistive tech. -->
        <v-btn
          v-if="helpTopic"
          icon="mdi-help-circle-outline"
          variant="text"
          size="small"
          density="comfortable"
          :title="`Help: ${title}`"
          :aria-label="`Help: ${title}`"
          @click="openHelpTopic(helpTopic)"
        />
      </div>
    </header>
    <div class="settings-panel-content"><slot /></div>
  </section>
</template>

<style scoped>
.settings-panel {
  /* Sized against this panel, not the viewport: the settings pane is a column inside a wider
     layout, so it can be narrow on a perfectly wide screen. A media query would miss that. */
  container-type: inline-size;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.085);
  border-radius: 10px;
  background: rgba(var(--v-theme-surface), 0.62);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.045);
}
.settings-panel + .settings-panel {
  margin-top: 13px;
}
.settings-panel--danger {
  border-color: rgba(var(--v-theme-error), 0.18);
}
.settings-panel-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 14px 17px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  background: rgba(var(--v-theme-background), 0.24);
}
.settings-panel-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}
.settings-panel--danger .settings-panel-icon {
  background: rgba(var(--v-theme-error), 0.09);
  color: rgb(var(--v-theme-error));
}
.settings-panel-heading h2 {
  margin: 0;
  font-size: 0.79rem;
  font-weight: 700;
}
.settings-panel-heading p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.67rem;
  line-height: 1.4;
}
.settings-panel-content {
  padding: 17px;
}
/* A leading <p> brings the browser's own top margin with it, which lands on top of the padding
   above and reads as a gap under the heading rule — visible wherever a panel opens with a
   paragraph rather than a control. The panel's padding is the spacing; nothing inside it needs to
   add more at the edges. */
.settings-panel-content > :first-child {
  margin-top: 0;
}
.settings-panel-content > :last-child {
  margin-bottom: 0;
}
.settings-panel-action {
  display: flex;
  flex-wrap: wrap;
  align-self: center;
  gap: 8px;
}
/* Slotted content belongs to the parent component, so scoped styles only reach it through
   :slotted. Every section wraps its buttons in a flex row of its own; this lets that row wrap
   rather than run off the edge. */
.settings-panel-action :slotted(*) {
  flex-wrap: wrap;
}
/* Narrow: the action moves to its own row beneath the heading.
   The three-column grid above is `auto minmax(0, 1fr) auto` — the text column can shrink to
   nothing while the action column keeps its full intrinsic width, so past a certain width the
   description collapsed to one word per line and the buttons still overflowed the panel and
   overlapped it. Giving the action its own row lets the text keep the width instead. */
@container (max-width: 560px) {
  .settings-panel-heading {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .settings-panel-action {
    grid-column: 1 / -1;
  }
}
</style>
