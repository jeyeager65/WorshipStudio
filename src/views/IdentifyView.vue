<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="identify-root">
    <div class="identify-icon">🖥️</div>
    <div class="identify-label">{{ label }}</div>
  </div>
</template>

<style scoped>
.identify-root {
  width: 100vw;
  height: 100vh;
  background: #1c2333;
  color: white;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.identify-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.identify-label {
  font-size: 28px;
  font-weight: 700;
  text-align: center;
  padding: 0 16px;
}
</style>
