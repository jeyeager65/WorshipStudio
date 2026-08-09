<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useConfirmDialogStore } from '@/stores/confirmDialog'

const store = useConfirmDialogStore()
const { isOpen, message, confirmLabel, saveLabel } = storeToRefs(store)
</script>

<template>
  <v-dialog v-model="isOpen" :max-width="saveLabel ? 560 : 420" persistent>
    <v-card>
      <v-card-text class="pt-4 text-body-1">{{ message }}</v-card-text>
      <v-card-actions class="flex-wrap ga-2">
        <v-spacer />
        <v-btn variant="flat" color="secondary" @click="store.respond('cancel')">Cancel</v-btn>
        <v-btn
          variant="flat"
          :color="saveLabel ? 'secondary' : 'error'"
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
