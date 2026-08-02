import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import ExternalAppFailureAlert from '@/components/service-workspace/ExternalAppFailureAlert.vue'

const vuetify = createVuetify()

describe('ExternalAppFailureAlert', () => {
  it('shows the error message and emits retry/skip', async () => {
    const wrapper = mount(ExternalAppFailureAlert, {
      props: { error: 'The application window never appeared.' },
      global: { plugins: [vuetify] },
    })
    expect(wrapper.text()).toContain('The application window never appeared.')
    expect(wrapper.find('.external-app-alert').exists()).toBe(true)

    await wrapper.find('button.v-btn').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)

    const buttons = wrapper.findAll('button.v-btn')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('skip')).toHaveLength(1)
  })
})
