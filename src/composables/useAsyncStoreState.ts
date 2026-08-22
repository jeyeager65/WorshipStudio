import { ref } from 'vue'
import { logger } from '@/utils/logger'

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'An unexpected error occurred.'
}

/**
 * Shared state contract for stores backed by asynchronous adapters. Initial loading is distinct
 * from background refresh so an existing collection never disappears behind a spinner. Load
 * failures are retained for retry; mutation failures are retained for the active editor while
 * still being rethrown so callers can decide whether navigation or dirty state should change.
 *
 * Every store built on this shares one logging point (`scope` is just that store's own
 * defineStore id) rather than each store logging its own load/save failures individually --
 * covers songs/services/slides/media/etc. saves and loads uniformly without instrumenting each
 * one by hand. Only failures are logged; a successful save/load is the unremarkable common case
 * and isn't worth a log line every time.
 */
export function useAsyncStoreState(scope: string) {
  const loaded = ref(false)
  const loading = ref(false)
  const refreshing = ref(false)
  const loadError = ref('')
  const mutationError = ref('')
  let activeLoad: Promise<boolean> | undefined

  function runLoad(operation: () => Promise<void>): Promise<boolean> {
    if (activeLoad) return activeLoad
    const initial = !loaded.value
    loading.value = initial
    refreshing.value = !initial
    loadError.value = ''
    activeLoad = (async () => {
      try {
        await operation()
        loaded.value = true
        return true
      } catch (error) {
        loadError.value = errorMessage(error)
        logger.error(scope, 'Failed to load', error)
        return false
      } finally {
        loading.value = false
        refreshing.value = false
        activeLoad = undefined
      }
    })()
    return activeLoad
  }

  async function runMutation<T>(operation: () => Promise<T>): Promise<T> {
    mutationError.value = ''
    try {
      return await operation()
    } catch (error) {
      mutationError.value = errorMessage(error)
      logger.error(scope, 'Failed to save', error)
      throw error
    }
  }

  function clearMutationError() {
    mutationError.value = ''
  }

  return {
    loaded,
    loading,
    refreshing,
    loadError,
    mutationError,
    runLoad,
    runMutation,
    clearMutationError,
  }
}
