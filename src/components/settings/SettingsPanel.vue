<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    tone?: 'default' | 'danger'
  }>(),
  { title: '', description: '', icon: '', tone: 'default' },
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
      <div v-if="$slots.action" class="settings-panel-action"><slot name="action" /></div>
    </header>
    <div class="settings-panel-content"><slot /></div>
  </section>
</template>

<style scoped>
.settings-panel {
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
.settings-panel-action {
  align-self: center;
}
</style>
