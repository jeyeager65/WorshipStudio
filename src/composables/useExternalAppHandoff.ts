import { computed, onUnmounted, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getAdapter } from '@/adapters'
import type { ExternalAppProfile } from '@/adapters/types'
import type { FlatSlide } from '@/utils/flattenService'
import type { Service, ServiceItem } from '@/models/service'
import { comboFromKeyboardEvent } from '@/utils/keyCombo'

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return fallback
}

/**
 * External App Hand-off (spec section 12): auto-launches/focuses a configured application when
 * its service item goes live, restores Worship Studio to the foreground when advancing past it,
 * verifies each external-app item is launchable ahead of time for the readiness check, and
 * forwards a Basic Remote Controls command's key combo to the app's own window — either via a
 * matching keyboard trigger (tryForwardKeydown) or its always-present button (sendManualCommand).
 * Mutates nothing on `service` — purely local hand-off state plus a read-only view into it for
 * the caller's own `readiness` computation.
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
  // presenting, a keydown matching one of its profile's commands' triggerKey fires that command
  // instead of whatever Worship Studio would otherwise do with that key (arrows/B/G's sidebar
  // nav/blank-screen/background-only, or nothing at all) — keyboard-only by design: clicking
  // Worship Studio's own on-screen Next/Previous, or tapping Next/Previous on the phone remote,
  // never fires a bound command, only that command's own button does (sendManualCommand below).
  // Synchronous and returns immediately on a match — useLiveTransport.ts's onKeydown needs the
  // boolean *before* the event's default action happens (to call preventDefault()), even though
  // the actual send is async and fires in the background.
  function tryForwardKeydown(event: KeyboardEvent): boolean {
    if (!isPresenting.value) return false
    const externalApp = liveSlide.value?.externalApp
    if (!externalApp) return false
    const profile = externalAppProfilesById.value.get(externalApp.profileId)
    if (!profile?.remoteControlsEnabled) return false
    const combo = comboFromKeyboardEvent(event)
    if (!combo) return false
    const command = profile.keyCommands.find((c) => c.triggerKey === combo)
    if (!command || !command.keyCombo.trim()) return false
    getAdapter()
      .externalApps?.sendKeystroke(profile.id, command.id)
      .catch((e) => console.error(`Failed to forward "${command.label}" to the external app:`, e))
    return true
  }

  // The always-present button (ServiceWorkspaceView's live-item panel, the phone Remote
  // Control) for a command — same fire-and-forget error handling as tryForwardKeydown above.
  const manualCommandError = ref<string>()
  async function sendManualCommand(profileId: string, commandId: string) {
    manualCommandError.value = undefined
    try {
      await getAdapter().externalApps?.sendKeystroke(profileId, commandId)
    } catch (e) {
      manualCommandError.value = errorMessage(e, 'Failed to send that command to the external app.')
    }
  }

  // External App Hand-off (spec section 12): "on advance" launches/focuses the configured app;
  // "on advancing past it" restores Worship Studio to the foreground. Tracked by FlatSlide key
  // (not just profileId) so re-visiting the *same* slide (e.g. navigating back to it) re-engages
  // rather than being treated as a no-op from a stale previous engagement.
  const externalAppActiveKey = ref<string>()
  const externalAppError = ref<string>()

  async function engageExternalAppIfNeeded() {
    const slide = liveSlide.value
    if (!isPresenting.value) {
      // Stop Presenting: close everything this session launched (there can be more than one,
      // across different items), not just minimize the most recent one — nothing should be left
      // for the operator to clean up by hand once presenting has actually ended.
      externalAppActiveKey.value = undefined
      externalAppError.value = undefined
      try {
        await getAdapter().externalApps?.closeAll()
      } catch (e) {
        console.error('Failed to close external apps:', e)
      }
      return
    }
    // Key we're about to be engaged for — undefined if the new slide isn't an external-app item
    // at all. Comparing against this (rather than just checking "is there an external app on
    // this slide") is what makes leaving-and-entering symmetric: moving straight from one
    // external-app item to a *different* one must restore/minimize the first before the second
    // launches, exactly the same as moving to an ordinary slide would — otherwise the first app
    // is simply never told to get out of the way and sits topmost over everything after it.
    const enteringKey = slide?.externalApp ? slide.key : undefined
    if (externalAppActiveKey.value === enteringKey) return

    if (externalAppActiveKey.value) {
      try {
        await getAdapter().externalApps?.restoreSelf()
      } catch (e) {
        console.error('Failed to restore Worship Studio to the foreground:', e)
      }
    }
    externalAppActiveKey.value = enteringKey
    externalAppError.value = undefined
    if (!slide?.externalApp) return

    try {
      await getAdapter().externalApps?.launch(slide.externalApp.profileId, slide.externalApp.file)
    } catch (e) {
      externalAppError.value = errorMessage(e, 'Failed to launch the external app.')
    }
  }
  watch([liveSlide, isPresenting], engageExternalAppIfNeeded)

  // Shared by the error alert's "Try Again" and the selected-item panel's "Reopen App" —
  // resetting the active key makes engageExternalAppIfNeeded treat it as a fresh engagement,
  // which re-launches (or, if the cached window from last time is still alive, just reuses it —
  // see launch_external_app's own cache on the Rust side).
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

  // Selected-item panel's "Close App" — an explicit, operator-requested close (e.g. they closed
  // it themselves at the OS level and want Worship Studio to stop believing it's still open, or
  // they just want it out of the way without stopping the whole presentation). Clearing the
  // active key means the next engagement of this same item launches fresh rather than trying to
  // reuse a handle that's about to stop existing.
  async function closeExternalApp() {
    externalAppActiveKey.value = undefined
    try {
      await getAdapter().externalApps?.closeCurrent()
    } catch (e) {
      console.error('Failed to close the external app:', e)
    }
  }

  // Selected-item panel's "Launch Now" — pre-launches an item's app while it *isn't* live yet
  // (before its slide, or even before Start Presenting), so the cold-start delay happens ahead
  // of time. Kept separate from externalAppError since that's specifically about the *live*
  // slide's engagement and this can target a different, not-yet-live item.
  const prelaunchError = ref<string>()
  async function prelaunchExternalApp(item: ServiceItem) {
    if (item.type !== 'external-app') return
    prelaunchError.value = undefined
    try {
      await getAdapter().externalApps?.prelaunch(item.profileId, item.file)
    } catch (e) {
      prelaunchError.value = errorMessage(e, 'Failed to launch the external app.')
    }
  }

  // Safety net: the router guard (router/index.ts) is what normally prevents leaving while
  // presenting, but if this view ever unmounts some other way, don't leave an external app
  // covering the audience display with nothing left able to restore Worship Studio to it.
  onUnmounted(() => {
    if (externalAppActiveKey.value) getAdapter().externalApps?.closeAll()
  })

  return {
    externalAppError,
    verifiedExternalAppItemIds,
    externalAppReadinessErrors,
    externalAppVerificationAvailable,
    retryExternalApp,
    skipExternalAppError,
    closeExternalApp,
    prelaunchError,
    prelaunchExternalApp,
    tryForwardKeydown,
    manualCommandError,
    sendManualCommand,
  }
}
