<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfirmDialogStore } from '@/stores/confirmDialog'

const store = useConfirmDialogStore()
const { isOpen, message, confirmLabel, saveLabel, requiredPhrase, typedPhrase } =
  storeToRefs(store)
const phraseMatches = computed(
  () => requiredPhrase.value === undefined || typedPhrase.value === requiredPhrase.value,
)

function confirmIfPhraseMatches() {
  if (phraseMatches.value) store.respond('confirm')
}
</script>

<template>
  <v-dialog v-model="isOpen" :max-width="saveLabel ? 560 : 420" persistent>
    <v-card>
      <v-card-text class="pt-4 text-body-1">
        {{ message }}
        <v-text-field
          v-if="requiredPhrase !== undefined"
          v-model="typedPhrase"
          :label="`Type ${requiredPhrase} to confirm`"
          variant="outlined"
          density="compact"
          autocomplete="off"
          class="mt-4"
          hide-details
          autofocus
          @keydown.enter="confirmIfPhraseMatches"
        />
      </v-card-text>
      <v-card-actions class="flex-wrap ga-2">
        <v-spacer />
        <v-btn variant="flat" color="secondary" @click="store.respond('cancel')">Cancel</v-btn>
        <v-btn
          variant="flat"
          :color="saveLabel ? 'secondary' : 'error'"
          :disabled="!phraseMatches"
          @click="store.respond('confirm')"
          >{{ confirmLabel }}</v-btn
        >
        <v-btn v-if="saveLabel" variant="flat" color="primary" @click="store.respond('save')">{{
          saveLabel
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
