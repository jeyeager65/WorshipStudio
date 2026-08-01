<script setup lang="ts">
withDefaults(
  defineProps<{
    icon: string
    title: string
    message: string
    compact?: boolean
  }>(),
  { compact: false },
)
</script>

<template>
  <div class="library-empty" :class="{ 'library-empty--compact': compact }">
    <span><v-icon :icon="icon" size="30" /></span>
    <h2>{{ title }}</h2>
    <p>{{ message }}</p>
    <div v-if="$slots.default" class="library-empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.library-empty {
  display: flex;
  min-height: 400px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 32px;
  text-align: center;
}
.library-empty--compact {
  min-height: 300px;
}
.library-empty > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  margin-bottom: 16px;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.library-empty h2 {
  margin: 0 0 5px;
  font-size: 1.05rem;
}
.library-empty p {
  max-width: 430px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.84rem;
  line-height: 1.5;
}
.library-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 9px;
  margin-top: 17px;
}
</style>
