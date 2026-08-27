import type { Announcement } from '@/models/announcement'

/**
 * Announcements for the demo library and "Load Sample Data".
 *
 * Kept beside sampleData.ts rather than in it because these are the one part of the sample set
 * that must be built *relative to today* to be worth anything: an announcement whose dates have
 * passed is filtered out of the bulletin entirely (announcementVisibility.ts), so hardcoded dates
 * would leave page 2 of the bulletin silently empty a few weeks after they were written — which is
 * exactly what a demo must not do.
 *
 * The spread is deliberate: a single-day event, a multi-day range, one with a free-text time, one
 * held back until nearer the date, and one standing notice with no event date at all. Between them
 * they exercise every field the model has and every branch of the visibility rules.
 */

const device = 'sample-data'

function isoDay(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function buildSampleAnnouncements(): Announcement[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'announcement-sample-potluck',
      text: 'Fellowship potluck following the morning service. Bring a dish to share — sign-up sheet is at the welcome desk.',
      eventDate: isoDay(7),
      eventTime: 'after the service',
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      id: 'announcement-sample-vbs',
      text: 'Vacation Bible School registration is now open for children entering kindergarten through grade 5. Register at the welcome desk or speak with Ruth Palmer.',
      eventDate: isoDay(24),
      eventEndDate: isoDay(28),
      eventTime: '9am-12pm',
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      id: 'announcement-sample-workday',
      text: 'Church grounds workday. Bring gloves and yard tools if you have them; lunch is provided.',
      eventDate: isoDay(13),
      eventTime: '8am-1pm',
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      // showFrom holds this back until the week before — the "don't announce it yet" pattern.
      id: 'announcement-sample-members-meeting',
      text: 'Quarterly members meeting in the fellowship hall. All members are encouraged to attend.',
      eventDate: isoDay(35),
      eventTime: '6:00pm',
      showFrom: isoDay(21),
      updatedAt: now,
      updatedByDevice: device,
    },
    {
      // No event date at all: a standing notice that runs until it is taken down, which is why
      // showUntil has to be set explicitly here rather than derived from an event date.
      id: 'announcement-sample-nursery-volunteers',
      text: 'The nursery is looking for two more volunteers on the rotation. If you can help one Sunday a month, please speak with Petra Novak.',
      showUntil: isoDay(45),
      updatedAt: now,
      updatedByDevice: device,
    },
  ]
}
