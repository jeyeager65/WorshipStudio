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
    items: [
      { id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      { id: 'item-sermon', type: 'sermon', title: 'Our Lord’s Prayer', passages: [], mainPassageId: '', outline: [] },
    ],
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

  it('gives today, future, and past services their own distinct background class', () => {
    const todayIso = new Date().toISOString().slice(0, 10)
    const future = mount(ServiceCard, {
      props: { service: sampleService({ date: '2099-01-01' }) },
      global: { plugins: [vuetify, router] },
    })
    expect(future.classes()).toContain('service-card--future')

    const past = mount(ServiceCard, {
      props: { service: sampleService({ date: '2000-01-01' }) },
      global: { plugins: [vuetify, router] },
    })
    expect(past.classes()).toContain('service-card--past')

    const today = mount(ServiceCard, {
      props: { service: sampleService({ date: todayIso }) },
      global: { plugins: [vuetify, router] },
    })
    expect(today.classes()).toContain('service-card--today')
  })
})
