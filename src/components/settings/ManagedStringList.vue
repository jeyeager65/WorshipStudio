<script setup lang="ts">
import { ref } from 'vue'

/**
 * Add/remove editor for the small managed lists Settings needs in a few places
 * (Service Types, Preachers, Song Collections) — same underlying pattern each time
 * (spec section 1/17), so it's factored out once rather than repeated three times.
 */
const props = defineProps<{ modelValue: string[]; addLabel: string }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const newValue = ref('')

function add() {
  const value = newValue.value.trim()
  if (!value || props.modelValue.includes(value)) return
  emit('update:modelValue', [...props.modelValue, value])
  newValue.value = ''
}
function remove(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}
</script>

<template>
  <div>
    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip v-for="(item, index) in modelValue" :key="item" closable @click:close="remove(index)">
        {{ item }}
      </v-chip>
      <p v-if="modelValue.length === 0" class="text-medium-emphasis text-body-2">None yet.</p>
    </div>
    <div class="d-flex ga-2" style="max-width: 400px">
      <v-text-field v-model="newValue" :label="addLabel" variant="outlined" density="compact" hide-details @keydown.enter="add" />
      <v-btn variant="flat" color="primary" icon="mdi-plus" @click="add" />
    </div>
  </div>
</template>
