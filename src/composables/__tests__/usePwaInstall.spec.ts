import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { usePwaInstall } from '../usePwaInstall'

function mountHost() {
  let exposed!: ReturnType<typeof usePwaInstall>
  const Host = defineComponent({
    setup() {
      exposed = usePwaInstall()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { wrapper, get install() { return exposed } }
}

function stubUserAgent(userAgent: string) {
  vi.stubGlobal('navigator', { ...navigator, userAgent })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  stubUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/1.0')
})

describe('usePwaInstall', () => {
  it('canInstall becomes true once beforeinstallprompt fires, and the default is suppressed', () => {
    const { install } = mountHost()
    expect(install.canInstall.value).toBe(false)

    const event = new Event('beforeinstallprompt', { cancelable: true })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(install.canInstall.value).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
  })

  it('promptInstall() replays the captured prompt and resets canInstall', async () => {
    const { install } = mountHost()
    const prompt = vi.fn()
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    window.dispatchEvent(event)

    await install.promptInstall()

    expect(prompt).toHaveBeenCalled()
    expect(install.canInstall.value).toBe(false)
  })

  it('promptInstall() before any prompt was captured is a safe no-op', async () => {
    const { install } = mountHost()
    await expect(install.promptInstall()).resolves.toBeUndefined()
  })

  it('flags iOS Safari, which has no beforeinstallprompt at all', () => {
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15')
    const { install } = mountHost()
    expect(install.isIos.value).toBe(true)
  })

  it('does not flag non-iOS browsers', () => {
    const { install } = mountHost()
    expect(install.isIos.value).toBe(false)
  })
})
