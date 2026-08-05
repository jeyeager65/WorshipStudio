<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

// A deliberate "this record is gone" state, distinct from AsyncLoadState's loading/error
// states — a genuinely missing song/service/person isn't a failed load an operator can retry,
// so it gets its own icon/title/description/back-action treatment instead of an error alert
// with a Retry button that would just fail again. Matches the pattern already established by
// ThemeEditorView/ServiceTemplateEditorView's own "Not Found" empty states.
defineProps<{
  icon: string
  title: string
  message: string
  backTo: RouteLocationRaw
  backLabel: string
}>()
</script>

<template>
  <section class="editor-not-found">
    <span class="editor-not-found-icon"><v-icon :icon="icon" size="32" /></span>
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <v-btn color="primary" variant="flat" prepend-icon="mdi-arrow-left" :to="backTo">
      {{ backLabel }}
    </v-btn>
  </section>
</template>

<style scoped>
.editor-not-found {
  display: flex;
  min-height: 340px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.editor-not-found-icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 13px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}
.editor-not-found h2 {
  margin: 14px 0 4px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 1.05rem;
}
.editor-not-found p {
  max-width: 420px;
  margin: 0 0 18px;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.84rem;
  line-height: 1.5;
}
</style>
