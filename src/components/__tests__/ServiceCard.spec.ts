import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createVuetify } from 'vuetify'
import ServiceCard from '@/components/ServiceCard.vue'
import { localCalendarDate } from '@/utils/calendarDate'
import type { Service } from '@/models/service'

const vuetify = createVuetify()
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/service/:id', component: { template: '<div />' } },
    { path: '/service/:id/plan', component: { template: '<div />' } },
  ],
})

function sampleService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    date: '2026-07-19',
    serviceTypeId: 'type-sunday-morning-worship',
    serviceTemplateName: 'Sunday Worship',
    items: [
      { id: 'item-1', type: 'song', songId: 'song-1', arrangement: { sequence: [] } },
      {
        id: 'item-sermon',
        type: 'sermon',
        title: 'Our Lord’s Prayer',
        passages: [],
        mainPassageId: '',
        outline: [],
      },
    ],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('ServiceCard', () => {
  it('shows the service type, date, subtitle, and song count', () => {
    const wrapper = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService() },
      global: { plugins: [vuetify, router] },
    })
    const text = wrapper.text()
    expect(text).toContain('Sunday Morning Worship')
    expect(text).toContain('July 19')
    expect(text).toContain('Our Lord’s Prayer')
    expect(text).toContain('1 song')
    expect(text).toContain('planned')
  })

  it('shows "incomplete" when a role has no one assigned', () => {
    const wrapper = mount(ServiceCard, {
      props: {
        serviceTypeName: 'Sunday Morning Worship',
        service: sampleService({
          assignments: [{ role: 'Worship Leader', personId: undefined, tentative: false }],
        }),
      },
      global: { plugins: [vuetify, router] },
    })
    expect(wrapper.text()).toContain('incomplete')
  })

  it('shows a plural song count and "not yet started" when empty', () => {
    const wrapper = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService({ items: [] }) },
      global: { plugins: [vuetify, router] },
    })
    expect(wrapper.text()).toContain('0 songs')
    expect(wrapper.text()).toContain('not yet started')
  })

  it('shows the applied template and hides progress ratios when no template is applied', () => {
    const withTemplate = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService() },
      global: { plugins: [vuetify, router] },
    })
    expect(withTemplate.text()).toContain('Sunday Worship')
    expect(withTemplate.text()).toContain('1 of 1 songs')

    const withoutTemplate = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService({ serviceTemplateName: undefined }) },
      global: { plugins: [vuetify, router] },
    })
    expect(withoutTemplate.text()).toContain('No template applied')
    expect(withoutTemplate.text()).not.toContain('1 of 1 songs')
  })

  it('renders the badge when provided', () => {
    const wrapper = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService(), badge: 'TODAY' },
      global: { plugins: [vuetify, router] },
    })
    expect(wrapper.text()).toContain('TODAY')
  })

  it('gives today, future, and past services their own distinct background class', () => {
    const todayIso = localCalendarDate()
    const future = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService({ date: '2099-01-01' }) },
      global: { plugins: [vuetify, router] },
    })
    expect(future.classes()).toContain('service-card--future')

    const past = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService({ date: '2000-01-01' }) },
      global: { plugins: [vuetify, router] },
    })
    expect(past.classes()).toContain('service-card--past')

    const today = mount(ServiceCard, {
      props: { serviceTypeName: 'Sunday Morning Worship', service: sampleService({ date: todayIso }) },
      global: { plugins: [vuetify, router] },
    })
    expect(today.classes()).toContain('service-card--today')
  })
})
