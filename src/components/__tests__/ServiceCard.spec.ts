import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createVuetify } from 'vuetify'
import ServiceCard from '@/components/ServiceCard.vue'
import type { Service } from '@/models/service'

const vuetify = createVuetify()
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/service/:id', component: { template: '<div />' } }],
})

function sampleService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    date: '2026-07-19',
    type: 'Sunday Morning Worship',
    sermonTitle: 'Our Lord’s Prayer',
    items: [{ id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } }],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('ServiceCard', () => {
  it('shows the service type, date, subtitle, and song count', () => {
    const wrapper = mount(ServiceCard, {
      props: { service: sampleService() },
      global: { plugins: [vuetify, router] },
    })
    const text = wrapper.text()
    expect(text).toContain('Sunday Morning Worship')
    expect(text).toContain('July 19')
    expect(text).toContain('Our Lord’s Prayer')
    expect(text).toContain('1 song')
    expect(text).toContain('draft')
  })

  it('shows a plural song count and "not yet started" when empty', () => {
    const wrapper = mount(ServiceCard, {
      props: { service: sampleService({ items: [] }) },
      global: { plugins: [vuetify, router] },
    })
    expect(wrapper.text()).toContain('0 songs')
    expect(wrapper.text()).toContain('not yet started')
  })

  it('renders the badge when provided', () => {
    const wrapper = mount(ServiceCard, {
      props: { service: sampleService(), badge: 'TODAY' },
      global: { plugins: [vuetify, router] },
    })
    expect(wrapper.text()).toContain('TODAY')
  })
})
