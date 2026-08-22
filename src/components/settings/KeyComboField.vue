<script setup lang="ts">
import { ref } from 'vue'
import { comboFromKeyboardEvent, formatKeyCombo } from '@/utils/keyCombo'

// Click-to-record key combo capture — see notes/architecture-plan.md's External App Hand-off
// section and keyCombo.ts's own doc comment for why this is a bespoke component rather than a
// validated text input or an existing library: every findable Vue/Vuetify package for keyboard
// shortcuts is a *binding* library (declare a combo, run a handler when it's pressed globally),
// not a *recorder* input for a settings form, and a non-technical operator hand-typing
// "Ctrl+Shift+F5" correctly is a worse failure mode than a component that just listens.
const { modelValue, placeholder = 'Click, then press a key' } = defineProps<{
  modelValue?: string
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

const recording = ref(false)

function startRecording() {
  recording.value = true
}

function stopRecording() {
  recording.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (!recording.value) return
  // Always suppressed while recording — otherwise Enter/Space would also "click" this button
  // (Vuetify's own default button activation), and Escape/Tab would close the parent dialog or
  // move focus away instead of being captured as the combo itself.
  event.preventDefault()
  event.stopPropagation()
  const combo = comboFromKeyboardEvent(event)
  // undefined means a pure-modifier keydown (Ctrl/Shift/Alt alone) — keep recording for the
  // real key that follows rather than treating the modifier itself as the whole combo.
  if (!combo) return
  emit('update:modelValue', combo)
  recording.value = false
}

function clear() {
  emit('update:modelValue', undefined)
}
</script>

<template>
  <div class="d-flex align-center ga-1">
    <v-btn
      variant="outlined"
      size="small"
      :color="recording ? 'primary' : undefined"
      class="key-combo-btn"
      @click="startRecording"
      @keydown="onKeydown"
      @blur="stopRecording"
    >
      {{ recording ? 'Press a key…' : modelValue ? formatKeyCombo(modelValue) : placeholder }}
    </v-btn>
    <!-- Always rendered (never v-if), just hidden when empty — otherwise this button's own
         width would come and go with whether a value is set, so two side-by-side fields (one
         with a value, one without) would show their main buttons at different widths and no
         longer visually line up with each other. -->
    <v-btn
      icon="mdi-close"
      variant="text"
      size="small"
      title="Clear"
      aria-label="Clear key combo"
      :style="{ visibility: modelValue ? 'visible' : 'hidden' }"
      :disabled="!modelValue"
      @click="clear"
    />
  </div>
</template>

<style scoped>
.key-combo-btn {
  flex: 1 1 auto;
  min-width: 120px;
}
</style>
