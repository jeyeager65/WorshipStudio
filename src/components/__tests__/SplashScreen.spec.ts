import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import SplashScreen from '@/components/SplashScreen.vue'

const vuetify = createVuetify()

describe('SplashScreen', () => {
  it('shows the church name, credit line, and status text', () => {
    const wrapper = mount(SplashScreen, {
      props: { churchName: 'Hope Community Church', statusText: 'Loading library…' },
      global: { plugins: [vuetify] },
    })
    const text = wrapper.text()
    expect(text).toContain('Hope Community Church')
    expect(text).toContain('Running on')
    expect(text).toContain('Worship Studio')
    expect(text).toContain('Loading library…')
  })

  it('falls back to "Worship Studio" as the headline when no church name is set yet', () => {
    const wrapper = mount(SplashScreen, {
      props: { statusText: 'Loading settings…' },
      global: { plugins: [vuetify] },
    })
    expect(wrapper.find('.church-name').text()).toBe('Worship Studio')
  })

  it('builds the gradient from the given brand colors', () => {
    const wrapper = mount(SplashScreen, {
      props: { statusText: 'Loading…', primaryColor: '#111111', secondaryColor: '#222222' },
      global: { plugins: [vuetify] },
    })
    // jsdom normalizes hex to rgb() in the serialized style attribute.
    const style = wrapper.find('.splash-bg').attributes('style') ?? ''
    expect(style).toContain('rgb(17, 17, 17)')
    expect(style).toContain('rgb(34, 34, 34)')
  })
})
