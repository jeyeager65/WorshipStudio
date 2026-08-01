<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  description: string
  icon: string
}>()
</script>

<template>
  <header class="settings-page-header">
    <div class="settings-page-copy">
      <span>{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <span class="settings-page-icon" aria-hidden="true">
      <v-icon :icon="icon" size="27" />
    </span>
  </header>
</template>

<style scoped>
.settings-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
  padding: 22px 24px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background:
    radial-gradient(circle at 92% 0, rgba(var(--v-theme-primary), 0.09), transparent 180px),
    rgba(var(--v-theme-surface), 0.72);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.07);
}
.settings-page-copy {
  min-width: 0;
}
.settings-page-copy > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.66rem;
  font-weight: 740;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.settings-page-copy h1 {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.45rem;
  font-weight: 690;
  letter-spacing: -0.025em;
}
.settings-page-copy p {
  max-width: 680px;
  margin: 7px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.53);
  font-size: 0.76rem;
  line-height: 1.5;
}
.settings-page-icon {
  display: grid;
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.15);
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
@media (max-width: 560px) {
  .settings-page-header {
    padding: 18px;
  }
  .settings-page-icon {
    display: none;
  }
}
</style>
