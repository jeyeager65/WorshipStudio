/**
 * State for the filters slide-over that every library screen shows below the shared 900px
 * "compact" breakpoint (see the `.app-filters` block in assets/base.css for the CSS half of the
 * contract, and the markup contract documented alongside it).
 *
 * Shared rather than a `ref(false)` per page so the five screens can't drift on behaviour the way
 * they did on styling: the toggle button must *toggle* (tapping the filter icon again to dismiss
 * is the obvious gesture, and the first version only ever opened — the panel could be dismissed
 * only by clicking the scrim, which isn't discoverable), and Escape must close it, which is what
 * anyone expects of an overlay.
 */
import { onUnmounted, ref, watch } from 'vue'

export function useFiltersPanel() {
  const filtersOpen = ref(false)

  function toggleFilters() {
    filtersOpen.value = !filtersOpen.value
  }
  function closeFilters() {
    filtersOpen.value = false
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeFilters()
  }

  // Listener only while the panel is actually open — a page-lifetime Escape handler on every
  // library screen would be one more thing competing for the key with whatever dialog is on top.
  watch(filtersOpen, (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  })
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))

  return { filtersOpen, toggleFilters, closeFilters }
}
