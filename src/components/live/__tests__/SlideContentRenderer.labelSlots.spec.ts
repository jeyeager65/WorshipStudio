import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SlideContentRenderer from '@/components/live/SlideContentRenderer.vue'
import type { LiveSlideContent } from '@/adapters/types'

/**
 * The header and footer are measured to decide how much vertical room the auto-fit text may use,
 * and that measurement reads an always-mounted *slot* element rather than the label inside it.
 *
 * That indirection is load-bearing, not stylistic. Each label sits in a `<Transition mode="out-in">`
 * keyed on its own text; Vue unmounts the outgoing vnode straight away and only defers the DOM
 * removal until the fade ends, and a template ref is nulled at unmount rather than at removal. A ref
 * on the label itself therefore reads null for the whole crossfade while the label is still plainly
 * on screen — and that is exactly when the fit runs, so it reserved no space for labels the audience
 * could see and sized the text to overrun them. It went wrong only when the label *text* changed,
 * since that is what changes the key: moving to the first slide of an item broke, moving between
 * slides within one item did not.
 *
 * These pin the arrangement, not the arithmetic. jsdom has no layout, so the reserved pixels cannot
 * be asserted here; nor can the crossfade window itself, which jsdom resolves synchronously. What
 * they catch is the shape of a regression — a ref moved back onto a transitioning label, or a slot
 * flattened into a sibling — which is how this would come back.
 */

function content(overrides: Partial<LiveSlideContent> = {}): LiveSlideContent {
  return {
    itemLabel: 'Be Thou My Vision',
    subLabel: 'Verse 1',
    text: 'Be Thou my vision, O Lord of my heart;',
    footerText: 'Hymnal One #62',
    fontRange: { minPx: 28, maxPx: 72 },
    lineWrap: true,
    ...overrides,
  }
}

describe('SlideContentRenderer label slots', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver, and the component sets one up on mount. A stub that never fires
    // is right for these: they assert on structure, and jsdom reports every box as zero-sized
    // anyway, so a real one would have nothing to report.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    // Likewise document.fonts, which the component subscribes to so it can re-fit once a webfont
    // finishes loading. jsdom loads no fonts, so an inert stub is faithful.
    if (!document.fonts) {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { addEventListener() {}, removeEventListener() {} },
      })
    }
  })

  it('keeps the measured header and footer elements across a label change', async () => {
    const wrapper = mount(SlideContentRenderer, {
      props: { content: content(), transition: true },
    })

    const headerSlot = wrapper.find('.slide-header-slot').element
    const footerSlot = wrapper.find('.slide-footer-slot').element

    // A different item — both labels change, which is the case that used to null both refs.
    await wrapper.setProps({
      content: content({
        itemLabel: 'Amazing Grace',
        text: 'Amazing grace, how sweet the sound',
        footerText: 'Hymnal One #12',
      }),
    })

    expect(wrapper.find('.slide-header-slot').element).toBe(headerSlot)
    expect(wrapper.find('.slide-footer-slot').element).toBe(footerSlot)
  })

  it('nests each label inside its slot rather than beside it', () => {
    const wrapper = mount(SlideContentRenderer, { props: { content: content() } })

    // The slot only reports a label's footprint if the label is a descendant of it. Placing the
    // two as siblings would leave the slot permanently zero-height, which `occupied()` reads as
    // "no label" — the same under-reservation as the original bug, arrived at another way.
    expect(wrapper.find('.slide-header-slot .slide-header').exists()).toBe(true)
    expect(wrapper.find('.slide-footer-slot .slide-footer').exists()).toBe(true)
  })

  it('carries the theme styling on the label rather than inheriting it', () => {
    const wrapper = mount(SlideContentRenderer, {
      props: {
        content: content({
          presentationTheme: {
            fontFamily: 'Roboto Slab Variable',
            textColor: '#F5F7FA',
            textEffect: { type: 'none', color: '#000000', size: 0 },
            backgroundColor: '#1F3A5F',
          },
        }),
      },
    })

    // Inheriting from .slide-root would restyle the outgoing label the moment the slide changed,
    // while it is still fading out with the previous slide's text — the current slide's words in
    // the next slide's font. Owning the properties lets the style freeze along with the text.
    const header = wrapper.find('.slide-header').attributes('style') ?? ''
    expect(header).toContain('Roboto Slab Variable')
    expect(wrapper.find('.slide-footer').attributes('style') ?? '').toContain(
      'Roboto Slab Variable',
    )
  })

  it('leaves the slot empty when the slide has no such label', () => {
    const wrapper = mount(SlideContentRenderer, {
      // '' is "this song has no collection, hide the footer", distinct from undefined.
      props: { content: content({ footerText: '' }) },
    })

    expect(wrapper.find('.slide-header-slot .slide-header').exists()).toBe(true)
    expect(wrapper.find('.slide-footer-slot .slide-footer').exists()).toBe(false)
  })
})
