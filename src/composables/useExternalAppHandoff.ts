import { computed, onUnmounted, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { ExternalAppProfile } from '@/adapters/types'
import type { FlatSlide } from '@/utils/flattenService'
import type { Service, ServiceItem } from '@/models/service'

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return fallback
}

/**
 * External App Hand-off (spec section 12): auto-launches/focuses a configured application when
 * its service item goes live, restores Worship Studio to the foreground when advancing past it,
 * verifies each external-app item is launchable ahead of time for the readiness check, and
 * forwards Next/Prev as a keystroke to the app's own window when its profile has that configured
 * (Basic Remote Controls). Mutates nothing on `service` — purely local hand-off state plus a
 * read-only view into it for the caller's own `readiness` computation.
 */
export function useExternalAppHandoff(
  service: Ref<Service | undefined>,
  liveSlide: ComputedRef<FlatSlide | undefined>,
  isPresenting: Ref<boolean>,
  externalAppProfilesById: ComputedRef<Map<string, ExternalAppProfile>>,
) {
  const verifiedExternalAppItemIds = reactive(new Set<string>())
  const externalAppReadinessErrors = reactive(new Map<string, string>())
  const externalAppVerificationAvailable = computed(() => !!getAdapter().externalApps?.verifyItem)

  async function verifyExternalAppReadiness(item: ServiceItem) {
    const verifyItem = getAdapter().externalApps?.verifyItem
    if (item.type !== 'external-app' || !verifyItem) return
    const profileId = item.profileId
    const file = item.file
    verifiedExternalAppItemIds.delete(item.id)
    externalAppReadinessErrors.delete(item.id)
    try {
      await verifyItem(profileId, file)
      const current = service.value?.items.find((candidate) => candidate.id === item.id)
      if (
        current?.type !== 'external-app' ||
        current.profileId !== profileId ||
        current.file !== file
      )
        return
      verifiedExternalAppItemIds.add(item.id)
    } catch (error) {
      const current = service.value?.items.find((candidate) => candidate.id === item.id)
      if (
        current?.type !== 'external-app' ||
        current.profileId !== profileId ||
        current.file !== file
      )
        return
      externalAppReadinessErrors.set(
        item.id,
        errorMessage(error, 'The external application could not be verified.'),
      )
    }
  }

  const externalAppReadinessItems = computed(() =>
    (service.value?.items ?? [])
      .filter((item) => item.type === 'external-app')
      .map((item) => ({ ...item })),
  )
  watch(
    externalAppReadinessItems,
    (items) => {
      const activeIds = new Set(items.map((item) => item.id))
      for (const id of verifiedExternalAppItemIds) {
        if (!activeIds.has(id)) verifiedExternalAppItemIds.delete(id)
      }
      for (const id of externalAppReadinessErrors.keys()) {
        if (!activeIds.has(id)) externalAppReadinessErrors.delete(id)
      }
      for (const item of items) void verifyExternalAppReadiness(item)
    },
    { immediate: true },
  )

  // Basic Remote Controls (spec section 12) — while an External App Hand-off item is live and
  // its profile has this configured, Next/Prev forward a keystroke to the app's own window
  // instead of advancing the service's slide sequence.
  async function tryForwardKeystroke(direction: 'next' | 'previous'): Promise<boolean> {
    if (!isPresenting.value) return false
    const externalApp = liveSlide.value?.externalApp
    if (!externalApp) return false
    const profile = externalAppProfilesById.value.get(externalApp.profileId)
    const key = direction === 'next' ? profile?.nextKey : profile?.prevKey
    if (!profile?.remoteControlsEnabled || !key) return false
    try {
      await getAdapter().externalApps?.sendKeystroke(profile.id, direction)
    } catch (e) {
      console.error(`Failed to forward ${direction} to the external app:`, e)
    }
    return true
  }

  // External App Hand-off (spec section 12): "on advance" launches/focuses the configured app;
  // "on advancing past it" restores Worship Studio to the foreground. Tracked by FlatSlide key
  // (not just profileId) so re-visiting the *same* slide (e.g. navigating back to it) re-engages
  // rather than being treated as a no-op from a stale previous engagement.
  const externalAppActiveKey = ref<string>()
  const externalAppError = ref<string>()

  async function engageExternalAppIfNeeded() {
    const slide = liveSlide.value
    if (!isPresenting.value || !slide?.externalApp) {
      if (externalAppActiveKey.value) {
        externalAppActiveKey.value = undefined
        externalAppError.value = undefined
        try {
          await getAdapter().externalApps?.restoreSelf()
        } catch (e) {
          console.error('Failed to restore Worship Studio to the foreground:', e)
        }
      }
      return
    }
    if (externalAppActiveKey.value === slide.key) return
    externalAppActiveKey.value = slide.key
    externalAppError.value = undefined
    try {
      await getAdapter().externalApps?.launch(slide.externalApp.profileId, slide.externalApp.file)
    } catch (e) {
      externalAppError.value = errorMessage(e, 'Failed to launch the external app.')
    }
  }
  watch([liveSlide, isPresenting], engageExternalAppIfNeeded)

  async function retryExternalApp() {
    externalAppActiveKey.value = undefined
    await engageExternalAppIfNeeded()
  }
  function skipExternalAppError() {
    // Deliberately doesn't force navigation — the operator moves on with Next/Prev whenever
    // ready, same "clear failure, operator decides" pattern as section 13's video errors. The
    // audience display stays on whatever was live before (untouched, since setLiveContent above
    // is skipped for external-app slides either way).
    externalAppError.value = undefined
  }

  // Safety net: the router guard (router/index.ts) is what normally prevents leaving while
  // presenting, but if this view ever unmounts some other way, don't leave an external app
  // covering the audience display with nothing left able to restore Worship Studio to it.
  onUnmounted(() => {
    if (externalAppActiveKey.value) getAdapter().externalApps?.restoreSelf()
  })

  return {
    externalAppError,
    verifiedExternalAppItemIds,
    externalAppReadinessErrors,
    externalAppVerificationAvailable,
    retryExternalApp,
    skipExternalAppError,
    tryForwardKeystroke,
  }
}
