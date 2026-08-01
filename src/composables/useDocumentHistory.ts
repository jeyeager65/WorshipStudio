import { watch, type Ref } from 'vue'
import { useHistoryStore } from '@/stores/history'

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

const editElementIds = new WeakMap<Element, string>()

function editElementId(element: Element): string {
  let id = editElementIds.get(element)
  if (!id) {
    id = crypto.randomUUID()
    editElementIds.set(element, id)
  }
  return id
}

function activeEditGroup(documentLabel: string): { label: string; groupKey?: string } {
  const element = document.activeElement
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  ) {
    const fieldLabel =
      element.getAttribute('aria-label') ||
      element.getAttribute('name') ||
      element.closest('.v-field')?.querySelector('label')?.textContent?.trim()
    return {
      label: fieldLabel ? `Edit ${fieldLabel}` : `Edit ${documentLabel}`,
      groupKey: `field:${editElementId(element)}`,
    }
  }
  return { label: `Edit ${documentLabel}` }
}

/**
 * Captures deep document snapshots for the active editor. Text entered continuously in the
 * same field is grouped; structural changes remain individual steps. History registration is
 * explicit so asynchronous initial data never appears as an undoable user edit.
 */
export function useDocumentHistory<T>(source: Ref<T | undefined>, documentLabel: string) {
  const history = useHistoryStore()
  let previous: T | undefined
  let applying = false
  let stopWatch: (() => void) | undefined
  let unregister: (() => void) | undefined

  function applySnapshot(snapshot: T) {
    applying = true
    source.value = cloneValue(snapshot)
    previous = cloneValue(snapshot)
    applying = false
  }

  function start(onDirtyChange: (dirty: boolean) => void, initiallyDirty = false) {
    stop()
    if (source.value === undefined) return
    previous = cloneValue(source.value)
    unregister = history.registerScope(onDirtyChange, initiallyDirty)
    stopWatch = watch(
      source,
      (value) => {
        if (applying || value === undefined || previous === undefined) return
        const after = cloneValue(value)
        if (valuesMatch(previous, after)) return
        const before = cloneValue(previous)
        const { label, groupKey } = activeEditGroup(documentLabel)
        history.push(
          label,
          () => applySnapshot(before),
          () => applySnapshot(after),
          groupKey,
        )
        previous = after
      },
      { deep: true, flush: 'sync' },
    )
  }

  function stop() {
    stopWatch?.()
    unregister?.()
    stopWatch = undefined
    unregister = undefined
    previous = undefined
  }

  return { start, stop }
}
