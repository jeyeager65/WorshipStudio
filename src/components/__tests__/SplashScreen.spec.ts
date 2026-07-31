import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import SplashScreen from '@/components/SplashScreen.vue'

const vuetify = createVuetify()

describe('SplashScreen', () => {
  it('shows the Worship Studio logo and status text', () => {
    const wrapper = mount(SplashScreen, {
      props: { statusText: 'Loading library…', step: 2 },
      global: { plugins: [vuetify] },
    })
    expect(wrapper.text()).toContain('Loading library…')
    expect(wrapper.findAll('.step')).toHaveLength(3)
    expect(wrapper.findAll('.step')[1].classes()).toContain('step--active')
    expect(wrapper.find('.logo-image').attributes('alt')).toBe('Worship Studio')
  })
})
