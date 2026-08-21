<script setup lang="ts">
import { ref } from 'vue'
import { getVersion } from '@tauri-apps/api/app'
import logoDark from '@/assets/logo-dark.png'

defineProps<{
  statusText: string
  step: number
}>()

const steps = ['Preferences', 'Services']

// Same fallback Settings > About already uses — getVersion() is Tauri-only and rejects in the
// browser demo build, where __APP_VERSION__ (vite.config.ts) is the real fallback instead.
const appVersion = ref(__APP_VERSION__)
void getVersion()
  .then((version) => (appVersion.value = version))
  .catch(() => {})
</script>

<template>
  <div class="splash-bg">
    <div class="splash">
      <img :src="logoDark" alt="Worship Studio" class="logo-image" />

      <div class="startup-steps" aria-hidden="true">
        <template v-for="(label, index) in steps" :key="label">
          <div
            class="step"
            :class="{ 'step--active': step === index + 1, 'step--complete': step > index + 1 }"
          >
            <span class="step-dot">
              <!-- Plain CSS shape, not an icon font or an SVG path: this screen paints before
                   the MDI webfont has necessarily loaded (a missing glyph shows as a stray box,
                   not nothing), and a real installed build also showed the same box in place of
                   an inline SVG checkmark here -- a WebView2-specific paint issue with this
                   particular case that a plain border-only shape has no equivalent of, since
                   there's no font, vector path, or dynamic attribute involved at all. -->
              <span v-if="step > index + 1" class="check-mark" aria-hidden="true" />
            </span>
            <span>{{ label }}</span>
          </div>
          <span
            v-if="index < steps.length - 1"
            class="step-line"
            :class="{ 'step-line--complete': step > index + 1 }"
          />
        </template>
      </div>
      <div class="status-row" role="status" aria-live="polite">
        <span v-if="step < 3" class="status-pulse" />
        <span v-else class="ready-icon" aria-hidden="true"><span class="check-mark" /></span>
        <span class="status-text">{{ statusText }}</span>
      </div>
    </div>
    <div v-if="appVersion" class="version-credit">v{{ appVersion }}</div>
  </div>
</template>

<style scoped>
.splash-bg {
  position: fixed;
  inset: 0;
  /* Matches the dark surface behind the logo on Settings > About. The logo PNG is
     transparent, so its artwork sits directly on this charcoal rather than on black. */
  background: #151b23;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  z-index: 9999;
}
.splash-bg::before {
  position: absolute;
  inset: 1px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  content: '';
  pointer-events: none;
}
.splash {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: white;
  text-align: center;
}
.logo-image {
  display: block;
  width: min(79vw, 550px);
  height: auto;
  margin-bottom: 42px;
}
.startup-steps {
  display: flex;
  align-items: flex-start;
  margin-bottom: 22px;
}
.step {
  display: flex;
  width: 72px;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.38);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: color 180ms ease;
}
.step-dot {
  display: flex;
  width: 17px;
  height: 17px;
  align-items: center;
  justify-content: center;
  border: 2px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  transition: all 180ms ease;
}
/* A checkmark built from two plain borders rotated 45deg -- no font, no SVG, no vector path
   binding. currentColor so it automatically matches whichever container it's in (step-dot's own
   white on completion, or ready-icon's white below). */
.check-mark {
  width: 5px;
  height: 9px;
  margin-bottom: 2px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
}
.step--active {
  color: rgba(255, 255, 255, 0.92);
}
.step--active .step-dot {
  border-color: #76a0f4;
  background: rgba(76, 127, 232, 0.25);
  box-shadow: 0 0 0 4px rgba(76, 127, 232, 0.1);
}
.step--complete {
  color: rgba(255, 255, 255, 0.66);
}
.step--complete .step-dot {
  border-color: #4c7fe8;
  background: #4c7fe8;
  color: white;
}
.step-line {
  width: 42px;
  height: 1px;
  margin: 8px -9px 0;
  background: rgba(255, 255, 255, 0.16);
  transition: background-color 180ms ease;
}
.step-line--complete {
  background: rgba(76, 127, 232, 0.75);
}
.status-row {
  display: flex;
  min-height: 18px;
  align-items: center;
  gap: 9px;
}
.status-pulse {
  width: 7px;
  height: 7px;
  background: #76a0f4;
  border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(118, 160, 244, 0.45);
  animation: status-pulse 1.4s ease-out infinite;
}
.ready-icon {
  display: flex;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #70bd91;
  color: white;
}
.ready-icon .check-mark {
  width: 4px;
  height: 8px;
  margin-bottom: 1px;
  border-width: 0 1.5px 1.5px 0;
}
.status-text {
  color: rgba(255, 255, 255, 0.72);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.015em;
}
.version-credit {
  position: absolute;
  right: 16px;
  bottom: 12px;
  color: rgba(255, 255, 255, 0.32);
  font-size: 11px;
  letter-spacing: 0.02em;
}

@keyframes status-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(118, 160, 244, 0.45);
  }
  70%,
  100% {
    box-shadow: 0 0 0 6px rgba(118, 160, 244, 0);
  }
}
</style>
