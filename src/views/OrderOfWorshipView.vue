<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { getAdapter } from '@/adapters'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { usePeopleStore } from '@/stores/people'
import { buildOrderOfWorship, toDocxBlob, toHtml, toPlainText } from '@/utils/orderOfWorship'
import type { Service } from '@/models/service'
import { personDisplayName } from '@/models/library'

const route = useRoute()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const peopleStore = usePeopleStore()

const service = ref<Service>()
const copiedMessage = ref('')

onMounted(async () => {
  const [loadedService] = await Promise.all([
    getAdapter().services.get(route.params.id as string),
    songsStore.loaded ? Promise.resolve() : songsStore.load(),
    slidesStore.loaded ? Promise.resolve() : slidesStore.load(),
    peopleStore.loaded ? Promise.resolve() : peopleStore.load(),
  ])
  service.value = loadedService
})

const personNames = computed(() => new Map(peopleStore.people.map((p) => [p.id, personDisplayName(p)])))

const doc = computed(() =>
  service.value ? buildOrderOfWorship(service.value, songsStore.songs, slidesStore.slides, personNames.value) : undefined,
)

let copiedTimeout: ReturnType<typeof setTimeout> | undefined
function flashCopied(message: string) {
  copiedMessage.value = message
  clearTimeout(copiedTimeout)
  copiedTimeout = setTimeout(() => (copiedMessage.value = ''), 2500)
}

async function copyAsFormatted() {
  if (!doc.value) return
  const html = toHtml(doc.value)
  const text = toPlainText(doc.value)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])
  } catch {
    // Rich clipboard writes aren't available everywhere (older browsers, some Tauri webview
    // configurations) — plain text still pastes into an email body, just without formatting.
    await navigator.clipboard.writeText(text)
  }
  flashCopied('Copied — paste into an email or document')
}

async function exportWord() {
  if (!doc.value || !service.value) return
  // A genuine .docx (OOXML) file, built directly from the same doc/line structure toHtml/
  // toPlainText use (see utils/orderOfWorship.ts's toDocxBlob) — not the older "HTML saved with
  // a .doc extension" trick, which Word tolerates but isn't a real Word file.
  const blob = await toDocxBlob(doc.value)
  const filename = `Order of Worship - ${service.value.date}.docx`

  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    // A plain <a download> click on a blob: URL isn't reliably handled inside the Tauri
    // desktop shell's webview the way it is in a real browser tab — the native save dialog
    // plus a small custom write command (see src-tauri/src/commands/files.rs) is what
    // actually saves a file to disk here.
    const path = await save({ defaultPath: filename, filters: [{ name: 'Word Document', extensions: ['docx'] }] })
    if (!path) return
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
    await invoke('write_binary_file', { path, contents: bytes })
    flashCopied('Saved')
    return
  }

  // The static web demo (mock adapter, no Tauri backend) runs in a real browser tab, where a
  // blob: URL anchor download works fine on its own.
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Composing/previewing is real; actually sending is deliberately not wired up to any mail
// transport (see adapters/types.ts's EmailPort.sendOrderOfWorship) — nothing here can dispatch
// a real email regardless of which adapter is running. Mirrors the Assignments page's identical
// "Send by Email" dialog rather than a mailto: link, which depends on the operator's OS having a
// default mail client configured at all — unreliable, and not what most people expect from a
// button in this app (they'd rather export the Word file and attach it themselves).
const emailDialogOpen = ref(false)
const emailSent = ref(false)
const recipientEmails = computed(() =>
  [...new Set(service.value?.assignments?.map((a) => a.personId) ?? [])]
    .map((id) => peopleStore.people.find((p) => p.id === id)?.email)
    .filter((email): email is string => !!email),
)
function openEmailDialog() {
  emailSent.value = false
  emailDialogOpen.value = true
}
async function sendEmail() {
  if (!doc.value || !service.value) return
  await getAdapter().email.sendOrderOfWorship(service.value.id, recipientEmails.value, toPlainText(doc.value))
  emailSent.value = true
}
</script>

<template>
  <div v-if="service && doc" class="d-flex justify-center ga-6 pa-6 oow-layout">
    <v-card class="oow-preview pa-8">
      <div class="text-center mb-6">
        <div class="text-h6 font-weight-bold">{{ doc.title }}</div>
        <div class="oow-date mt-1">{{ doc.dateLine }}</div>
      </div>

      <div v-for="(line, index) in doc.lines" :key="index" :class="line.separatorBefore || index === 0 ? 'mb-3' : 'mb-1'">
        <p class="oow-line oow-line-row mb-0">
          <span>
            <span v-if="line.role" class="font-weight-bold">{{ line.role }} </span>
            <template v-if="line.text">{{ line.text }}</template>
          </span>
          <span v-if="line.person" class="font-italic oow-person">{{ line.person }}</span>
        </p>
        <p v-if="line.note" class="oow-line oow-line-note mb-0 mt-0">{{ line.note }}</p>
      </div>
    </v-card>

    <div class="oow-side">
      <div class="text-overline text-medium-emphasis mb-3">Export Order of Worship</div>
      <v-card variant="outlined" class="pa-4">
        <v-btn variant="flat" color="primary" block class="mb-2" @click="copyAsFormatted">Copy Formatted</v-btn>
        <v-btn variant="outlined" block class="mb-2" @click="exportWord">Export as Word Document</v-btn>
        <v-btn variant="outlined" block prepend-icon="mdi-email-outline" @click="openEmailDialog">Send by Email</v-btn>
        <p class="text-caption text-medium-emphasis mt-3">
          Generated directly from this service's songs, scripture, and slides — in the order they appear, with
          each item's Person field included where set.
        </p>
      </v-card>
      <v-alert v-if="copiedMessage" type="success" variant="tonal" density="compact" class="mt-3">
        {{ copiedMessage }}
      </v-alert>
    </div>

    <v-dialog v-model="emailDialogOpen" max-width="520">
      <v-card>
        <v-card-title>Send Order of Worship by Email</v-card-title>
        <v-card-text>
          <p class="text-caption text-medium-emphasis mb-2">
            {{ recipientEmails.length }} recipient(s) with an email on file: {{ recipientEmails.join(', ') || 'none' }}
          </p>
          <v-textarea :model-value="doc ? toPlainText(doc) : ''" label="Message" variant="outlined" rows="8" readonly />
          <v-alert v-if="emailSent" type="info" variant="tonal" density="compact" class="mt-2">
            Not sent — email delivery isn't connected to a mail server in this build yet. Export as a Word Document
            and attach it yourself for now.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" class="mr-2" @click="emailDialogOpen = false">Close</v-btn>
          <v-btn variant="flat" color="primary" @click="sendEmail">Send</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <v-container v-else class="py-8">
    <p class="text-medium-emphasis">Service not found.</p>
  </v-container>
</template>

<style scoped>
.oow-preview {
  width: 620px;
  font-family: Georgia, serif;
  color: #1a1a1a;
  background: #fff;
}
/* An explicit color, not Vuetify's .text-medium-emphasis utility — that class sets its own
   color from the app's current *theme* (near-white in dark mode), overriding whatever this
   print-styled white card sets on itself, which made this line invisible (white on white) in
   dark mode regardless of the app's theme. */
.oow-date {
  font-size: 12px;
  color: #555;
}
.oow-line {
  font-size: 14px;
  line-height: 1.5;
}
.oow-line-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.oow-person {
  flex-shrink: 0;
  text-align: right;
}
.oow-line-note {
  font-size: 12px;
  color: #888;
  font-style: italic;
}
.oow-side {
  width: 300px;
}
</style>
