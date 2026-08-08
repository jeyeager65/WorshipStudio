<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatServiceTime } from '@/utils/serviceTime'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    hideDetails?: boolean
  }>(),
  { hideDetails: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const menuOpen = ref(false)
const pickerView = ref<'hour' | 'minute'>('hour')
const allowedMinutes = Array.from({ length: 12 }, (_, index) => index * 5)
const displayValue = computed(() => formatServiceTime(props.modelValue) ?? '')

watch(menuOpen, (open) => {
  if (open) pickerView.value = 'hour'
})

function selectTime(value: string | null) {
  emit('update:modelValue', value ?? '')
}
</script>

<template>
  <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom">
    <template #activator="{ props: activatorProps }">
      <v-text-field
        v-bind="activatorProps"
        :model-value="displayValue"
        :label="label"
        :hide-details="hideDetails"
        variant="outlined"
        readonly
        clearable
        append-inner-icon="mdi-clock-outline"
        @click:clear="selectTime(null)"
      />
    </template>
    <v-time-picker
      :model-value="modelValue || null"
      :allowed-minutes="allowedMinutes"
      v-model:view-mode="pickerView"
      @update:model-value="selectTime"
      @update:minute="menuOpen = false"
    />
  </v-menu>
</template>
