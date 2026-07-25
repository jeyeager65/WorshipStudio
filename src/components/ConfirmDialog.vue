<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useConfirmDialogStore } from '@/stores/confirmDialog'

const store = useConfirmDialogStore()
const { isOpen, message } = storeToRefs(store)
</script>

<template>
  <v-dialog v-model="isOpen" max-width="420" persistent>
    <v-card>
      <v-card-text class="pt-4 text-body-1">{{ message }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="flat" color="secondary" @click="store.respond(false)">Cancel</v-btn>
        <v-btn variant="flat" color="error" @click="store.respond(true)">Leave Without Saving</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
