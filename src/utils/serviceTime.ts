import type { Service } from '@/models/service'

/** Formats the stored local HH:mm value without allowing Date to apply a timezone offset. */
export function formatServiceTime(time: string | undefined): string | undefined {
  const match = time?.match(/^(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Sort key for services on the same date. Untimed legacy services follow timed services. */
export function serviceDateTimeSortKey(service: Pick<Service, 'date' | 'time'>): string {
  return `${service.date}T${service.time || '99:99'}`
}
