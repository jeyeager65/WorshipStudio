<script setup lang="ts">
withDefaults(
  defineProps<{
    churchName?: string
    primaryColor?: string
    secondaryColor?: string
    statusText: string
  }>(),
  {
    primaryColor: '#3b5bdb',
    secondaryColor: '#8a5bd6',
  },
)
</script>

<template>
  <div class="splash-bg" :style="{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }">
    <div class="splash">
      <div class="logo-badge">
        <v-icon icon="mdi-church" size="40" color="white" />
      </div>
      <div class="church-name">{{ churchName || 'Worship Studio' }}</div>
      <div class="powered-by">Running on <strong>Worship Studio</strong></div>

      <div class="progress-track">
        <div class="progress-fill" />
      </div>
      <div class="status-text">{{ statusText }}</div>
    </div>
  </div>
</template>

<style scoped>
.splash-bg {
  position: fixed;
  inset: 0;
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
.logo-badge {
  width: 96px;
  height: 96px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.15);
  border: 2px solid rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}
.church-name {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
}
.powered-by {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin-bottom: 40px;
  letter-spacing: 0.02em;
}
.powered-by strong {
  color: rgba(255, 255, 255, 0.9);
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

/* Indeterminate rather than tied to a real byte-count progress figure — nothing in the
   loading sequence (settings + service list) exposes fine-grained progress to bind to. */
@keyframes splash-indeterminate {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(280%);
  }
}
</style>
