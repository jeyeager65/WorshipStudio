<script setup lang="ts">
import logoDark from '@/assets/logo-dark.png'

defineProps<{
  statusText: string
}>()
</script>

<template>
  <div class="splash-bg">
    <div class="splash">
      <img :src="logoDark" alt="Worship Studio" class="logo-image" />

      <div class="progress-track">
        <div class="progress-fill" />
      </div>
      <div class="status-text">{{ statusText }}</div>
    </div>
  </div>
</template>

<style scoped>
/* Solid black, matching logo-dark.png's own canvas, so the image reads as the whole screen
   rather than a graphic sitting on a separate background. */
.splash-bg {
  position: fixed;
  inset: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.splash {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: white;
  text-align: center;
}
.logo-image {
  display: block;
  width: min(85vw, 620px);
  height: auto;
  margin-bottom: 56px;
}
.progress-track {
  width: 220px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 12px;
}
.progress-fill {
  height: 100%;
  width: 40%;
  background: white;
  border-radius: 999px;
  animation: splash-indeterminate 1.1s ease-in-out infinite;
}
.status-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

/* Indeterminate rather than tied to a real percentage — statusText (App.vue) reflects real,
   discrete loading steps (settings, then services) as they actually happen, but nothing
   exposes fine-grained progress within a step (e.g. "service 45 of 230") to bind a real
   percentage to. */
@keyframes splash-indeterminate {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(280%);
  }
}
</style>
