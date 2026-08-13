import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { getAdapter } from '@/adapters'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { cssFontFamily, resolvePresentationFontFamily } from '@/utils/presentationFonts'
import { presentationTextEffect } from '@/utils/presentationTextEffect'
import { resolvePresentationTheme } from '@/utils/presentationTheme'
import type { FlatSlide } from '@/utils/flattenService'
import type { Service } from '@/models/service'
import type { MediaItem } from '@/models/library'
import type { ServiceReadinessResult } from '@/utils/serviceReadiness'
import type {
  DisplayInfo,
  LivePresentationTheme,
  LiveSlideContent,
  RemoteCommand,
} from '@/adapters/types'

function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return fallback
}

interface UseLiveTransportOptions {
  service: Ref<Service | undefined>
  selectedItemIndex: Ref<number>
  flatSlides: ComputedRef<FlatSlide[]>
  mediaById: ComputedRef<Map<string, MediaItem>>
  mediaUrlById: Map<string, string>
  themesStore: ReturnType<typeof useThemesStore>
  settingsStore: ReturnType<typeof useSettingsStore>
  isPresenting: Ref<boolean>
  readiness: ComputedRef<ServiceReadinessResult>
  readinessDialogOpen: Ref<boolean>
  tryForwardKeystroke: (direction: 'next' | 'previous') => Promise<boolean>
  /** Remote Control (spec section 4/12): a Full Control device gets the same "Reopen App" /
   *  "Close App" buttons the operator's own transport bar shows while an External App Hand-off
   *  item is live — same underlying calls as those buttons, just triggered remotely. */
  retryExternalApp: () => Promise<void>
  closeExternalApp: () => Promise<void>
}

/**
 * The live-presentation engine: flattened Next/Prev transport across the whole service (spec
 * section 3), start/stop presenting, blank/background-only overrides, the audience-display
 * picker, and the operator's preview thumbnails. Also owns the keyboard shortcuts and the
 * Remote Control command listener, since both just call the transport functions below.
 *
 * The live position is tracked by the *stable* FlatSlide key rather than a raw array index —
 * reordering or deleting service items while presenting re-derives the working index fresh from
 * the current `flatSlides` on every read, so the live output can never silently drift to a
 * different item's slide the way a stored raw index could after the array shape changes.
 */
export function useLiveTransport(options: UseLiveTransportOptions) {
  const {
    service,
    selectedItemIndex,
    flatSlides,
    mediaById,
    mediaUrlById,
    themesStore,
    settingsStore,
    isPresenting,
    readiness,
    readinessDialogOpen,
    tryForwardKeystroke,
    retryExternalApp,
    closeExternalApp,
  } = options

  const liveSlideKey = ref<string>()
  const isBlankScreen = ref(false)
  const keyBeforeBlank = ref<string>()
  const backgroundOnly = ref(false)

  /** Always re-derived from the current `flatSlides` — see the module doc comment above for
   *  why this is a computed rather than a stored index. Same numeric convention as before:
   *  -1 = nothing live yet, `flatSlides.length` = blank screen, otherwise a real position. */
  const flatIndex = computed(() => {
    if (isBlankScreen.value) return flatSlides.value.length
    if (liveSlideKey.value === undefined) return -1
    return flatSlides.value.findIndex((s) => s.key === liveSlideKey.value)
  })

  const liveSlide = computed(() => {
    const index = flatIndex.value
    return index >= 0 && index < flatSlides.value.length ? flatSlides.value[index] : undefined
  })

  function describeSlide(index: number): string {
    const slide = flatSlides.value[index]
    if (slide) return `${slide.itemLabel} — ${slide.subLabel}`
    return flatSlides.value.length === 0 ? 'Service is empty' : 'End of service'
  }
  const nextIndex = computed(() =>
    flatIndex.value === -1
      ? 0
      : Math.min(flatIndex.value + 1, Math.max(flatSlides.value.length - 1, 0)),
  )
  const prevIndex = computed(() => Math.max(flatIndex.value - 1, 0))
  const previousDisabled = computed(() => flatSlides.value.length === 0 || flatIndex.value <= 0)
  const nextDisabled = computed(
    () => flatSlides.value.length === 0 || flatIndex.value >= flatSlides.value.length - 1,
  )
  const nextPreviewLabel = computed(() =>
    nextDisabled.value ? 'End of service' : describeSlide(nextIndex.value),
  )
  const prevPreviewLabel = computed(() =>
    previousDisabled.value ? 'Beginning of service' : describeSlide(prevIndex.value),
  )

  function goLive(index: number) {
    isBlankScreen.value = false
    liveSlideKey.value = flatSlides.value[index]?.key
  }

  async function next() {
    if (await tryForwardKeystroke('next')) return
    if (nextDisabled.value) return
    goLive(nextIndex.value)
  }
  async function previous() {
    if (await tryForwardKeystroke('previous')) return
    if (previousDisabled.value) return
    goLive(prevIndex.value)
  }
  function toggleBlankScreen() {
    if (isBlankScreen.value) {
      isBlankScreen.value = false
      liveSlideKey.value = keyBeforeBlank.value
      return
    }
    keyBeforeBlank.value = liveSlideKey.value
    backgroundOnly.value = false
    isBlankScreen.value = true
  }
  function toggleBackgroundOnly() {
    if (!liveSlide.value) return
    backgroundOnly.value = !backgroundOnly.value
  }
  // Bundles the fields every pushLiveState call site needs — the two that vary per call
  // (content, isPresenting) stay explicit params; externalAppActive also varies (the stop
  // branch deliberately forces it false rather than trusting liveSlide, which isn't cleared on
  // stop) so it stays a param too, while isBlankScreen/backgroundOnly/displaySize are always
  // read fresh off their own refs.
  function pushRemoteLiveState(
    content: LiveSlideContent | undefined,
    presenting: boolean,
    externalAppActive: boolean,
  ) {
    getAdapter().remote?.pushLiveState({
      content,
      isPresenting: presenting,
      externalAppActive,
      displaySize: presentationSize.value,
      isBlankScreen: isBlankScreen.value,
      backgroundOnly: backgroundOnly.value,
    })
  }

  async function togglePresenting() {
    if (!isPresenting.value) {
      await loadPresentationSize()
      if (readiness.value.blockers.length) {
        readinessDialogOpen.value = true
        return
      }
      if (!audienceDisplayAvailable.value) {
        await openPresentationDisplayDialog()
        return
      }
      await startPresentation()
    } else {
      await getAdapter().live.stopPresenting()
      isPresenting.value = false
      pushRemoteLiveState(undefined, false, false)
    }
  }

  async function startPresentation() {
    try {
      if (flatIndex.value === -1 && flatSlides.value.length > 0) goLive(0)
      await getAdapter().live.startPresenting()
      isPresenting.value = true
      // Explicit send in addition to the watch below — if flatIndex was already at this value
      // (e.g. the operator had already clicked this slide before pressing Start Presenting),
      // the watch alone wouldn't fire since liveContentPayload wouldn't actually change.
      await getAdapter().live.setLiveContent(liveContentPayload.value)
      pushRemoteLiveState(liveContentPayload.value, true, !!liveSlide.value?.externalApp)
    } catch (e) {
      console.error('Failed to start presentation:', e)
      audienceDisplayAvailable.value = false
      presentationDisplayError.value = errorMessage(
        e,
        'The audience display could not be opened. Check the connection and try again.',
      )
      await openPresentationDisplayDialog(false)
    }
  }

  function buildPresentationTheme(slide: FlatSlide): LivePresentationTheme | undefined {
    const theme = resolvePresentationTheme(
      service.value?.items[slide.itemIndex],
      slide.themeTarget,
      themesStore.themes,
    )
    if (!theme) return undefined
    const branding = settingsStore.librarySettings?.branding
    let backgroundColor = theme.backgroundColor ?? '#000000'
    if (theme.backgroundId === 'brand-primary')
      backgroundColor = branding?.primaryColor ?? '#3B5BDB'
    else if (theme.backgroundId === 'brand-secondary')
      backgroundColor = branding?.secondaryColor ?? '#8A5BD6'

    const backgroundMediaItem = theme.backgroundId
      ? mediaById.value.get(theme.backgroundId)
      : undefined
    const backgroundMediaUrl = backgroundMediaItem
      ? mediaUrlById.get(backgroundMediaItem.id)
      : undefined
    return {
      fontFamily: cssFontFamily(resolvePresentationFontFamily(theme.font)),
      textColor: theme.textColor,
      textEffect: presentationTextEffect(theme),
      backgroundColor,
      backgroundMedia:
        backgroundMediaItem && backgroundMediaUrl
          ? {
              url: backgroundMediaUrl,
              mediaId: backgroundMediaItem.id,
              kind: backgroundMediaItem.kind,
              fit: 'cover',
            }
          : undefined,
    }
  }

  // Shared by the live payload (sent to the presentation window/remote) and the Previous/Next
  // preview thumbnails below — same slide data, same settings, just a different destination.
  function buildLiveContent(slide: FlatSlide | undefined): LiveSlideContent | undefined {
    if (!slide) return undefined
    const mediaUrl = slide.mediaId ? mediaUrlById.get(slide.mediaId) : undefined
    return {
      itemLabel: slide.itemLabel,
      subLabel: slide.subLabel,
      text: slide.text,
      presentationTheme: buildPresentationTheme(slide),
      scene: slide.scene,
      serviceDateTime: slide.serviceDateTime,
      wayfindingBooks: slide.wayfindingBooks,
      bibleProgress: slide.bibleProgress,
      media:
        mediaUrl && slide.mediaId && slide.mediaKind && slide.mediaFit
          ? { url: mediaUrl, mediaId: slide.mediaId, kind: slide.mediaKind, fit: slide.mediaFit }
          : undefined,
      fontRange: slide.fontRange,
      lineWrap: slide.lineWrap,
      footerText: slide.footerText,
      repeatLabel: slide.repeatLabel,
      outlineTitle: slide.outlineTitle,
      headerFontSizePx: settingsStore.librarySettings?.slideHeaderFontSizePx,
      footerFontSizePx: settingsStore.librarySettings?.slideFooterFontSizePx,
      wayfindingMinFontSizePx: settingsStore.librarySettings?.wayfindingMinFontSizePx,
      wayfindingMaxFontSizePx: settingsStore.librarySettings?.wayfindingMaxFontSizePx,
    }
  }
  const liveContentPayload = computed<LiveSlideContent | undefined>(() => {
    const content = buildLiveContent(liveSlide.value)
    return content ? { ...content, backgroundOnly: backgroundOnly.value } : undefined
  })
  // A fade now plays across every slide change on the audience-facing output (see
  // SlideContentRenderer.vue's `transition` prop / notes/slide-transitions-plan.md). A
  // background image/video that hasn't finished loading by the time its slide goes live would
  // otherwise pop in mid-fade, reading as a stutter — backgrounds load lazily today, only
  // exactly when a slide carrying a new url first becomes live. This does a one-time browser
  // cache warm-up for every distinct background/media url in the service whenever the slide
  // list changes; `warmedMediaUrls` persists across calls so an already-warmed url is a cheap
  // Set lookup, not a repeat fetch. Distinct urls per service are typically few (most slides in
  // an item share one background), so this is a small, one-time cost, not a per-slide one.
  const warmedMediaUrls = new Set<string>()
  function warmMediaUrl(url: string | undefined, kind: 'image' | 'video' | undefined) {
    if (!url || !kind || warmedMediaUrls.has(url)) return
    warmedMediaUrls.add(url)
    if (kind === 'image') {
      new Image().src = url
    } else {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.src = url
    }
  }
  function warmBackgroundMediaCache(slides: FlatSlide[]) {
    for (const slide of slides) {
      const theme = buildPresentationTheme(slide)
      warmMediaUrl(theme?.backgroundMedia?.url, theme?.backgroundMedia?.kind)
      warmMediaUrl(slide.mediaId ? mediaUrlById.get(slide.mediaId) : undefined, slide.mediaKind)
    }
  }
  // Deliberately separate from liveContentPayload's watch below — this only needs to re-fire
  // when the service's own slide list changes (load, edit, reorder), not on every single slide
  // advance, unlike the moment-to-moment live-position push. `immediate` so a Full Control
  // phone gets the outline as soon as a service is loaded, not only after its first edit.
  watch(
    flatSlides,
    (slides) => {
      getAdapter().remote?.pushServiceOutline(
        slides.map((_, index) => ({ index, label: describeSlide(index) })),
      )
      warmBackgroundMediaCache(slides)
    },
    { immediate: true },
  )
  watch(liveContentPayload, (content) => {
    if (isPresenting.value) {
      // While an External App Hand-off item is live, Worship Studio's own presentation window
      // deliberately shows nothing new — the external app's window is what's actually on the
      // audience display now, covering ours by virtue of being brought to the foreground,
      // positioned over that same monitor.
      if (!liveSlide.value?.externalApp) getAdapter().live.setLiveContent(content)
      pushRemoteLiveState(content, true, !!liveSlide.value?.externalApp)
    }
  })

  // Previous/current/next preview thumbnails (right-hand column) — relative to the live
  // position, i.e. exactly what Previous/Next in the footer would move to/from, not whatever's
  // merely selected in the left panel.
  const previousPreview = computed(() => buildLiveContent(flatSlides.value[flatIndex.value - 1]))
  const nextPreview = computed(() => buildLiveContent(flatSlides.value[flatIndex.value + 1]))
  const previewSlots = computed(() => [
    { label: 'Previous', content: previousPreview.value, live: false },
    { label: 'Current', content: liveContentPayload.value, live: true },
    { label: 'Next', content: nextPreview.value, live: false },
  ])

  // The preview thumbnails render SlideContentRenderer at a fixed "virtual" size and visually
  // shrink the whole thing down via CSS transform, so the exact same auto-fit math that runs on
  // the real presentation window decides font sizes/wrapping here too — an absolute px font
  // range (e.g. scripture's 28-72px) would mean almost nothing if computed directly against a
  // box this small. On the booth computer the virtual size is the configured audience display's
  // exact logical size, matching live wrapping. A planning computer without an audience display
  // deliberately falls back to a stable 16:9 approximation; it cannot start presenting locally.
  const DEFAULT_PREVIEW_VIRTUAL_SIZE = { width: 1920, height: 1080 }
  const presentationSize = ref(DEFAULT_PREVIEW_VIRTUAL_SIZE)
  const audienceDisplayAvailable = ref(getAdapter().kind !== 'tauri')
  const presentationDisplayDialogOpen = ref(false)
  const presentationDisplays = ref<DisplayInfo[]>([])
  const presentationDisplaysLoading = ref(false)
  const selectedAudienceDisplayId = ref('')
  const presentationDisplayError = ref('')
  async function loadPresentationSize() {
    try {
      const measured = await getAdapter().live.getPresentationSize?.()
      presentationSize.value = measured ?? DEFAULT_PREVIEW_VIRTUAL_SIZE
      audienceDisplayAvailable.value = !!measured || getAdapter().kind !== 'tauri'
    } catch (e) {
      console.error('Failed to measure the presentation window size:', e)
      presentationSize.value = DEFAULT_PREVIEW_VIRTUAL_SIZE
      audienceDisplayAvailable.value = getAdapter().kind !== 'tauri'
    }
  }

  async function refreshPresentationDisplays(clearError = true) {
    presentationDisplaysLoading.value = true
    if (clearError) presentationDisplayError.value = ''
    try {
      presentationDisplays.value = (await getAdapter().displays?.list()) ?? []
      const selectable = presentationDisplays.value.filter((display) => display.role !== 'operator')
      const configured = selectable.find((display) => display.role === 'audience')
      if (configured) selectedAudienceDisplayId.value = configured.id
      else if (selectable.length === 1) selectedAudienceDisplayId.value = selectable[0]!.id
      else if (!selectable.some((display) => display.id === selectedAudienceDisplayId.value))
        selectedAudienceDisplayId.value = ''
    } catch (e) {
      presentationDisplays.value = []
      presentationDisplayError.value = errorMessage(e, 'Connected displays could not be detected.')
    } finally {
      presentationDisplaysLoading.value = false
    }
  }

  async function openPresentationDisplayDialog(clearError = true) {
    if (clearError) presentationDisplayError.value = ''
    presentationDisplayDialogOpen.value = true
    await refreshPresentationDisplays(clearError)
  }

  async function identifyPresentationDisplay(displayId: string) {
    try {
      await getAdapter().displays?.identify(displayId)
    } catch (e) {
      presentationDisplayError.value = errorMessage(e, 'The display could not be identified.')
    }
  }

  async function useAudienceDisplayAndStart() {
    const selected = presentationDisplays.value.find(
      (display) => display.id === selectedAudienceDisplayId.value,
    )
    if (!selected || selected.role === 'operator' || presentationDisplaysLoading.value) return
    presentationDisplaysLoading.value = true
    presentationDisplayError.value = ''
    try {
      const roleMap = settingsStore.machineSettings?.displayRoles ?? {}
      for (const [displayId, role] of Object.entries(roleMap)) {
        if (role === 'audience' && displayId !== selected.id) {
          await getAdapter().displays?.assignRole(displayId, 'not-used')
          roleMap[displayId] = 'not-used'
        }
      }
      await getAdapter().displays?.assignRole(selected.id, 'audience')
      roleMap[selected.id] = 'audience'
      await loadPresentationSize()
      if (!audienceDisplayAvailable.value)
        throw new Error('The selected display is no longer available.')
      presentationDisplayDialogOpen.value = false
      if (readiness.value.blockers.length) {
        readinessDialogOpen.value = true
        return
      }
      await startPresentation()
    } catch (e) {
      presentationDisplayError.value = errorMessage(
        e,
        'The audience display could not be configured.',
      )
    } finally {
      presentationDisplaysLoading.value = false
    }
  }
  const PREVIEW_VIRTUAL_SIZE = computed(() => presentationSize.value)
  // Bound to the outer .preview-panel (ServiceWorkspaceView.vue) — a single, always-present
  // element, simpler and more reliably observable than trying to target one specific thumbnail
  // out of the v-for below. The callback below measures .preview-item's real rendered rect, not
  // .preview-thumb's — deliberately the *available space*, not the thumb itself. Measuring the
  // thumb only ever shrinks: its own width is driven by previewThumbWidth in the first place, so
  // once clamped down by a narrow container, growing the container back doesn't change what the
  // thumb is currently requesting — nothing would ever ask it to request more. .preview-item has
  // no width of its own (a flex item stretching to fill .preview-list), so its rect always
  // reflects the true available space independent of whatever the thumb currently is, and tracks
  // correctly in both directions.
  const previewPanelRef = ref<HTMLElement>()
  const previewThumbWidth = ref(340)
  let previewResizeObserver: ResizeObserver | undefined
  const previewScale = computed(() => previewThumbWidth.value / PREVIEW_VIRTUAL_SIZE.value.width)
  /** Called by the caller once its own template has actually rendered the real workspace (not
   *  just once the service data has loaded) — the preview panel sits behind
   *  `v-if="workspaceLoading || workspaceLoadError"` up higher in that template, which only
   *  flips over once loading is fully done, so calling this any earlier finds
   *  previewPanelRef.value still unset and silently observes nothing, forever (this is only
   *  ever called once). */
  function observePreviewPanel() {
    if (typeof ResizeObserver === 'undefined') return
    if (!previewResizeObserver) {
      previewResizeObserver = new ResizeObserver(([entry]) => {
        const item = entry?.target.querySelector('.preview-item')
        if (!item) return
        // No floor beyond a small legibility minimum — on a narrow drawer (see
        // ServiceWorkspaceView.vue's compact layout), a thumbnail sized to a wider floor than
        // the panel actually has room for spills past its edge instead of just rendering
        // smaller, which is the behavior actually wanted here.
        previewThumbWidth.value = Math.max(120, Math.floor(item.getBoundingClientRect().width))
      })
    }
    if (previewPanelRef.value) previewResizeObserver.observe(previewPanelRef.value)
  }

  const currentSlideLabel = computed(() => {
    if (isBlankScreen.value) return 'Blank Screen'
    if (!liveSlide.value) return 'No Slide Selected'
    return `${liveSlide.value.itemLabel} — ${liveSlide.value.subLabel}`
  })
  const slidePositionLabel = computed(() => {
    if (flatSlides.value.length === 0) return 'No Slides'
    if (isBlankScreen.value) return 'Screen Blank'
    if (flatIndex.value < 0) return `${flatSlides.value.length} Slides Ready`
    return `Slide ${flatIndex.value + 1} of ${flatSlides.value.length}`
  })
  const liveContextSnippet = computed(() => {
    const firstLine = liveSlide.value?.text.split('\n')[0]
    return firstLine ? `"${firstLine}"` : ''
  })

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
    if (!service.value) return
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        selectedItemIndex.value = Math.max(0, selectedItemIndex.value - 1)
        break
      case 'ArrowDown':
        event.preventDefault()
        selectedItemIndex.value = Math.min(
          service.value.items.length - 1,
          selectedItemIndex.value + 1,
        )
        break
      case 'ArrowLeft':
        event.preventDefault()
        previous()
        break
      case 'ArrowRight':
        event.preventDefault()
        next()
        break
      case 'b':
      case 'B':
        event.preventDefault()
        toggleBlankScreen()
        break
      case 'g':
      case 'G':
        event.preventDefault()
        toggleBackgroundOnly()
        break
    }
  }

  let unlistenRemoteCommand: (() => void) | undefined
  onMounted(async () => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('focus', loadPresentationSize)
    await loadPresentationSize()
    // This composable only exists while ServiceWorkspaceView has a service open — a remote
    // device shouldn't see Start Presenting/Prev/Next/the slide picker before that's true, so
    // mount/unmount is exactly the right signal (see SharedLiveState::service_open's own doc
    // comment in remote_server.rs).
    getAdapter().remote?.pushServiceOpen(true)
    // Remote Control (spec section 4): a paired phone's button press arrives here the same
    // way the presentation window receives slide changes — as a Tauri event, not a direct
    // function call, since the HTTP server lives entirely on the Rust side.
    unlistenRemoteCommand = await getAdapter().remote?.onCommand((command: RemoteCommand) => {
      if (command.action === 'next') next()
      else if (command.action === 'previous') previous()
      else if (command.action === 'goto' && command.index !== undefined) goLive(command.index)
      else if (command.action === 'toggle-presenting') togglePresenting()
      else if (command.action === 'toggle-blank-screen') toggleBlankScreen()
      else if (command.action === 'toggle-background-only') toggleBackgroundOnly()
      else if (command.action === 'external-app-relaunch') void retryExternalApp()
      else if (command.action === 'external-app-close') void closeExternalApp()
    })
  })
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('focus', loadPresentationSize)
    // Safety net: the router guard (router/index.ts) is what normally prevents leaving while
    // presenting, but if this view ever unmounts some other way, don't leave the app
    // permanently believing a torn-down workspace is still live — or a presentation window
    // open with nothing left able to close it.
    if (isPresenting.value) getAdapter().live.stopPresenting()
    isPresenting.value = false
    getAdapter().remote?.pushServiceOpen(false)
    unlistenRemoteCommand?.()
    previewResizeObserver?.disconnect()
  })

  return {
    flatIndex,
    liveSlide,
    isBlankScreen,
    backgroundOnly,
    previousDisabled,
    nextDisabled,
    prevPreviewLabel,
    nextPreviewLabel,
    goLive,
    next,
    previous,
    toggleBlankScreen,
    toggleBackgroundOnly,
    togglePresenting,
    startPresentation,
    liveContentPayload,
    previewSlots,
    currentSlideLabel,
    slidePositionLabel,
    liveContextSnippet,
    audienceDisplayAvailable,
    presentationDisplayDialogOpen,
    presentationDisplays,
    presentationDisplaysLoading,
    selectedAudienceDisplayId,
    presentationDisplayError,
    loadPresentationSize,
    refreshPresentationDisplays,
    openPresentationDisplayDialog,
    identifyPresentationDisplay,
    useAudienceDisplayAndStart,
    PREVIEW_VIRTUAL_SIZE,
    previewPanelRef,
    previewThumbWidth,
    previewScale,
    observePreviewPanel,
  }
}
