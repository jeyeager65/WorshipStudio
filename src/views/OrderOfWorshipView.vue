<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getAdapter } from '@/adapters'
import { useSongsStore } from '@/stores/songs'
import { useSlidesStore } from '@/stores/slides'
import { useVolunteersStore } from '@/stores/volunteers'
import { buildOrderOfWorship, toHtml, toPlainText } from '@/utils/orderOfWorship'
import type { Service } from '@/models/service'

const route = useRoute()
const songsStore = useSongsStore()
const slidesStore = useSlidesStore()
const volunteersStore = useVolunteersStore()

const service = ref<Service>()
const copiedMessage = ref('')

onMounted(async () => {
  const [loadedService] = await Promise.all([
    getAdapter().services.get(route.params.id as string),
    songsStore.loaded ? Promise.resolve() : songsStore.load(),
    slidesStore.loaded ? Promise.resolve() : slidesStore.load(),
    volunteersStore.loaded ? Promise.resolve() : volunteersStore.load(),
  ])
  service.value = loadedService
})

const volunteerNames = computed(
  () => new Map(volunteersStore.volunteers.map((v) => [v.id, `${v.firstName} ${v.lastName}`])),
)

const doc = computed(() =>
  service.value ? buildOrderOfWorship(service.value, songsStore.songs, slidesStore.slides, volunteerNames.value) : undefined,
)

let copiedTimeout: ReturnType<typeof setTimeout> | undefined
function flashCopied(message: string) {
  copiedMessage.value = message
  clearTimeout(copiedTimeout)
  copiedTimeout = setTimeout(() => (copiedMessage.value = ''), 2500)
}

async function copyAsText() {
  if (!doc.value) return
  await navigator.clipboard.writeText(toPlainText(doc.value))
  flashCopied('Copied as plain text')
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
  flashCopied('Copied — paste into an email body')
}

function exportWord() {
  if (!doc.value || !service.value) return
  // A .doc file containing HTML — Word genuinely opens and edits this correctly (a
  // long-established, dependency-free technique), so no bundled docx-generation library is
  // needed just for this.
  const html = `<html><head><meta charset="utf-8"></head><body>${toHtml(doc.value)}</body></html>`
  const blob = new Blob([html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `Order of Worship - ${service.value.date}.doc`
  link.click()
  URL.revokeObjectURL(url)
}

function sendEmail() {
  if (!doc.value || !service.value) return
  // Opens the operator's own default mail client with the message pre-filled — nothing is
  // sent by this app itself; the operator still has to press Send from their own email
  // account, matching feature-spec.md's "no email-sending service required" design.
  const subject = encodeURIComponent(`${doc.value.title} — ${service.value.date}`)
  const body = encodeURIComponent(toPlainText(doc.value))
  window.location.href = `mailto:?subject=${subject}&body=${body}`
}
</script>

<template>
  <div v-if="service && doc" class="d-flex justify-center ga-6 pa-6 oow-layout">
    <v-card class="oow-preview pa-8">
      <div class="text-center mb-6">
        <div class="text-h6 font-weight-bold">{{ doc.title }}</div>
        <div class="text-caption text-medium-emphasis mt-1">{{ doc.dateLine }}</div>
      </div>

      <p v-if="doc.volunteerLine" class="oow-line mb-3">{{ doc.volunteerLine }}</p>
      <p v-else class="oow-note mb-3">
        Add Praise Team and Building assignments manually — no Volunteer Roster is set for this service.
      </p>

      <p v-for="(line, index) in doc.lines" :key="index" class="oow-line mb-3">
        <span v-if="line.role" class="font-weight-bold">{{ line.role }}</span>
        <template v-if="line.text"> {{ line.text }}</template>
        <span v-if="line.person" class="font-italic"> — {{ line.person }}</span>
      </p>

      <p v-if="doc.volunteerLine" class="oow-note mt-6">
        ✓ Praise Team and Building assignments included automatically from this service's Volunteer Roster.
      </p>
    </v-card>

    <div class="oow-side">
      <div class="text-overline text-medium-emphasis mb-3">Export Order of Worship</div>
      <v-card variant="outlined" class="pa-4">
        <v-btn variant="flat" color="primary" block class="mb-2" @click="copyAsText">Copy as Text</v-btn>
        <v-btn variant="outlined" block class="mb-2" @click="copyAsFormatted">Copy as Formatted (paste into email)</v-btn>
        <v-btn variant="outlined" block class="mb-2" @click="exportWord">Export as Word Document</v-btn>
        <v-btn variant="outlined" block prepend-icon="mdi-email-outline" @click="sendEmail">Send Email</v-btn>
        <p class="text-caption text-medium-emphasis mt-3">
          Generated directly from this service's songs, scripture, and slides — in the order they appear, with
          each item's Person field included where set.
        </p>
      </v-card>
      <v-alert v-if="copiedMessage" type="success" variant="tonal" density="compact" class="mt-3">
        {{ copiedMessage }}
      </v-alert>
    </div>
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
.oow-line {
  font-size: 14px;
  line-height: 1.5;
}
.oow-note {
  font-size: 12px;
  color: #888;
  font-style: italic;
  text-align: center;
  padding: 10px;
  border-top: 1px dashed #ccc;
  border-bottom: 1px dashed #ccc;
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
}
.oow-side {
  width: 300px;
}
</style>
