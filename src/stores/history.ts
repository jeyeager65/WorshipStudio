import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

interface HistoryEntry {
  label: string
  undo: () => void
  redo: () => void
  beforeStateId: number
  afterStateId: number
  groupKey?: string
  recordedAt: number
}

interface HistoryScope {
  id: string
  onDirtyChange: (dirty: boolean) => void
}

const GROUP_WINDOW_MS = 700

export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>([])
  const position = ref(0)
  const currentStateId = ref(0)
  const savedStateId = ref(0)
  const active = ref(false)
  let nextStateId = 1
  let scope: HistoryScope | undefined

  const canUndo = computed(() => active.value && position.value > 0)
  const canRedo = computed(() => active.value && position.value < entries.value.length)
  const undoLabel = computed(() => (canUndo.value ? entries.value[position.value - 1]?.label : ''))
  const redoLabel = computed(() => (canRedo.value ? entries.value[position.value]?.label : ''))

  function notifyDirty() {
    scope?.onDirtyChange(currentStateId.value !== savedStateId.value)
  }

  function registerScope(onDirtyChange: (dirty: boolean) => void, initiallyDirty = false) {
    const id = crypto.randomUUID()
    scope = { id, onDirtyChange }
    entries.value = []
    position.value = 0
    currentStateId.value = 0
    savedStateId.value = initiallyDirty ? -1 : 0
    nextStateId = 1
    active.value = true
    notifyDirty()
    return () => {
      if (scope?.id !== id) return
      scope = undefined
      entries.value = []
      position.value = 0
      active.value = false
    }
  }

  function push(label: string, undo: () => void, redo: () => void, groupKey?: string) {
    const now = Date.now()
    const previous = entries.value[position.value - 1]
    const canGroup =
      !!groupKey &&
      position.value === entries.value.length &&
      previous?.groupKey === groupKey &&
      now - previous.recordedAt <= GROUP_WINDOW_MS

    if (canGroup && previous) {
      previous.label = label
      previous.redo = redo
      previous.recordedAt = now
      currentStateId.value = previous.afterStateId
    } else {
      if (position.value < entries.value.length) entries.value.splice(position.value)
      const afterStateId = nextStateId++
      entries.value.push({
        label,
        undo,
        redo,
        beforeStateId: currentStateId.value,
        afterStateId,
        groupKey,
        recordedAt: now,
      })
      position.value = entries.value.length
      currentStateId.value = afterStateId
    }
    notifyDirty()
  }

  function undo() {
    if (!canUndo.value) return
    const entry = entries.value[position.value - 1]
    if (!entry) return
    entry.undo()
    position.value -= 1
    currentStateId.value = entry.beforeStateId
    notifyDirty()
  }

  function redo() {
    if (!canRedo.value) return
    const entry = entries.value[position.value]
    if (!entry) return
    entry.redo()
    position.value += 1
    currentStateId.value = entry.afterStateId
    notifyDirty()
  }

  function markSaved() {
    if (!active.value) return
    savedStateId.value = currentStateId.value
    notifyDirty()
  }

  return {
    active,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    registerScope,
    push,
    undo,
    redo,
    markSaved,
  }
})
