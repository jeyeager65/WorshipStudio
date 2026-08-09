<script setup lang="ts">
/**
 * Root component mounted by main.ts instead of App.vue directly. App.vue calls getAdapter()
 * synchronously at <script setup> module scope, so the adapter must already be resolved before
 * App.vue is even instantiated — this component exists to do that resolution first, showing a
 * chooser/resume UI only when it's actually needed (the real, non-demo web build with no already-
 * granted folder access), and rendering the real App.vue unchanged once ready.
 *
 * Tauri and the public GitHub Pages demo build resolve instantly, no UI shown — this only ever
 * becomes visible for a plain `pnpm build`/dev-server deploy running in a browser.
 */
import { onMounted, ref } from 'vue'
import App from '@/App.vue'
import { getAdapter, isPublicDemoBuild, isTauri, setAdapterInstance } from '@/adapters'
import { createMockAdapter } from '@/adapters/mock'
import { createWebAdapter } from '@/adapters/web'
import {
  clearStoredLibraryHandle,
  loadStoredLibraryHandle,
  storeLibraryHandle,
} from '@/adapters/web/handlePersistence'
import logoDark from '@/assets/logo-dark.png'

type Phase = 'resolving' | 'chooser' | 'resuming' | 'ready'

const phase = ref<Phase>('resolving')
const errorText = ref('')
const pendingHandle = ref<FileSystemDirectoryHandle>()
const fsaSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

onMounted(async () => {
  if (isTauri() || isPublicDemoBuild()) {
    // Unchanged existing behavior — getAdapter() itself still knows how to resolve these two,
    // this just makes sure it happens before App.vue reads it.
    setAdapterInstance(getAdapter())
    phase.value = 'ready'
    return
  }

  const stored = await loadStoredLibraryHandle().catch(() => undefined)
  if (!stored) {
    phase.value = 'chooser'
    return
  }
  const granted = await stored.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt')
  if (granted === 'granted') {
    setAdapterInstance(createWebAdapter(stored))
    phase.value = 'ready'
    return
  }
  pendingHandle.value = stored
  phase.value = 'resuming'
})

async function chooseDemo() {
  setAdapterInstance(createMockAdapter())
  phase.value = 'ready'
}

async function chooseFolder() {
  errorText.value = ''
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await storeLibraryHandle(handle)
    setAdapterInstance(createWebAdapter(handle))
    phase.value = 'ready'
  } catch (error) {
    // AbortError: the user cancelled the native picker — not a real failure, just stay put.
    if ((error as DOMException)?.name !== 'AbortError') {
      errorText.value = 'Could not open that folder. Please try again.'
    }
  }
}

async function resumeAccess() {
  errorText.value = ''
  const handle = pendingHandle.value
  if (!handle) return
  const granted = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')
  if (granted === 'granted') {
    setAdapterInstance(createWebAdapter(handle))
    phase.value = 'ready'
    return
  }
  errorText.value = 'Access was not granted. You can pick a folder again below.'
}

async function pickDifferentFolder() {
  await clearStoredLibraryHandle().catch(() => {})
  pendingHandle.value = undefined
  errorText.value = ''
  phase.value = 'chooser'
}
</script>

<template>
  <App v-if="phase === 'ready'" />
  <div v-else class="boot-gate">
    <v-card class="boot-card" elevation="8">
      <v-card-text class="boot-card-content">
        <img :src="logoDark" alt="Worship Studio" class="boot-logo" />

        <template v-if="phase === 'resolving'">
          <p class="boot-status">Loading…</p>
        </template>

        <template v-else-if="phase === 'chooser'">
          <p class="boot-lead">
            Open your church's library folder to prepare services, or try the demo with sample data.
          </p>
          <v-btn color="primary" size="large" block :disabled="!fsaSupported" @click="chooseFolder">
            Open Your Library Folder
          </v-btn>
          <p v-if="!fsaSupported" class="boot-note">
            This browser doesn't support opening a real folder — try Chrome or Edge. You can still
            try the demo below.
          </p>
          <v-btn variant="text" size="large" block class="mt-2" @click="chooseDemo">
            Try the Demo
          </v-btn>
        </template>

        <template v-else-if="phase === 'resuming'">
          <p class="boot-lead">Resume access to your library folder to continue.</p>
          <v-btn color="primary" size="large" block @click="resumeAccess">Resume Access</v-btn>
          <v-btn variant="text" size="large" block class="mt-2" @click="pickDifferentFolder">
            Pick a Different Folder
          </v-btn>
        </template>

        <p v-if="errorText" class="boot-error" role="alert">{{ errorText }}</p>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.boot-gate {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.boot-card {
  width: 100%;
  max-width: 420px;
}
.boot-card-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 32px 28px;
  text-align: center;
}
.boot-logo {
  align-self: center;
  width: min(70%, 260px);
  height: auto;
  margin-bottom: 8px;
}
.boot-lead {
  margin-bottom: 8px;
  opacity: 0.85;
}
.boot-status {
  opacity: 0.7;
}
.boot-note {
  margin-top: -4px;
  font-size: 0.8rem;
  opacity: 0.65;
}
.boot-error {
  margin-top: 4px;
  color: rgb(var(--v-theme-error));
  font-size: 0.85rem;
}
</style>
