import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useLiveTransport } from '../useLiveTransport'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import type { Service } from '@/models/service'

const { getAdapter } = vi.hoisted(() => ({ getAdapter: vi.fn() }))
vi.mock('@/adapters', () => ({ getAdapter }))

/**
 * Which order-of-service item the workspace has selected follows the live position.
 *
 * Moving live used to leave the selection wherever it last was, so an operator clicking Next
 * through a service watched the red live marker walk down the order list while the details pane
 * kept showing an item from several slides ago. The two directions are deliberately asymmetric:
 * moving live pulls the selection along, but selecting an item leaves live alone, which is what
 * lets an operator open a later item and work on it mid-service without disturbing the screen.
 */

function serviceWithThreeItems(): Service {
  return {
    id: 'service-1',
    date: '2026-08-30',
    time: '10:30',
    serviceTypeId: 'type-sunday',
    items: [
      { id: 'item-a', type: 'bulletin-note', bulletinLabel: 'Welcome' },
      {
        id: 'item-b',
        type: 'scripture',
        reference: 'John 1:1',
        translation: 'KJV',
        displayMode: 'full',
      },
      { id: 'item-c', type: 'bulletin-note', bulletinLabel: 'Benediction' },
    ],
    assignments: [],
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedByDevice: 'test',
  }
}

/** Three items, one flat slide each. Three rather than two so a test can park the selection
 *  somewhere that is neither where live is nor where it is about to land — with only two,
 *  "the selection followed" and "the selection never moved" are the same assertion. */
const flatSlides = [
  { key: 'a:0', itemIndex: 0, itemId: 'item-a', itemLabel: 'Welcome', subLabel: '', text: '' },
  { key: 'b:0', itemIndex: 1, itemId: 'item-b', itemLabel: 'John 1:1', subLabel: 'KJV', text: '' },
  { key: 'c:0', itemIndex: 2, itemId: 'item-c', itemLabel: 'Benediction', subLabel: '', text: '' },
]

function mountTransport() {
  const selectedItemIndex = ref(0)
  let api: ReturnType<typeof useLiveTransport> | undefined

  const wrapper = mount(
    defineComponent({
      setup() {
        api = useLiveTransport({
          service: ref(serviceWithThreeItems()),
          selectedItemIndex,
          flatSlides: computed(() => flatSlides),
          mediaById: computed(() => new Map()),
          mediaUrlById: new Map(),
          slidesById: computed(() => new Map()),
          themesStore: useThemesStore(),
          settingsStore: useSettingsStore(),
          isPresenting: ref(true),
          readiness: computed(() => ({ blockers: [], warnings: [] })),
          readinessDialogOpen: ref(false),
          externalAppProfilesById: computed(() => new Map()),
          tryForwardKeydown: () => false,
          retryExternalApp: async () => {},
          closeExternalApp: async () => {},
          sendManualCommand: async () => {},
        } as unknown as Parameters<typeof useLiveTransport>[0])
        return () => h('div')
      },
    }),
  )

  return { api: api!, selectedItemIndex, wrapper }
}

describe('useLiveTransport selection follows live', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getAdapter.mockReturnValue({
      kind: 'mock',
      live: {
        setLiveContent: vi.fn().mockResolvedValue(undefined),
        stopPresenting: vi.fn().mockResolvedValue(undefined),
        getPresentationSize: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
      },
    })
  })

  it('moves the selection to the item that just went live', async () => {
    const { api, selectedItemIndex } = mountTransport()

    api.goLive(0)
    expect(selectedItemIndex.value).toBe(0)

    // Next crosses into the second item — the case where the details pane used to be left behind.
    await api.next()
    expect(selectedItemIndex.value).toBe(1)

    await api.previous()
    expect(selectedItemIndex.value).toBe(0)
  })

  it('leaves the live slide alone when the selection moves on its own', async () => {
    const { api, selectedItemIndex } = mountTransport()

    api.goLive(0)
    selectedItemIndex.value = 1

    // The whole point of the asymmetry: an operator reading ahead has not changed the screen.
    expect(api.liveSlide.value?.key).toBe('a:0')
    expect(api.flatIndex.value).toBe(0)
  })

  it('re-syncs the selection to live on the next move after wandering', async () => {
    const { api, selectedItemIndex } = mountTransport()

    api.goLive(0)
    // Reading ahead to the last item — neither where live is nor where it is about to go, so
    // "followed live" and "stayed put" cannot be confused for one another.
    selectedItemIndex.value = 2

    // Next advances from the *live* position, not the selected one, and the selection catches up
    // rather than being left out at the far end of the service.
    await api.next()
    expect(api.liveSlide.value?.key).toBe('b:0')
    expect(selectedItemIndex.value).toBe(1)
  })
})
