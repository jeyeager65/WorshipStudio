import type { Service } from '@/models/service'

/** Formats the stored local HH:mm value without allowing Date to apply a timezone offset. */
export function formatServiceTime(time: string | undefined): string | undefined {
  const match = time?.match(/^(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Sort key for services on the same date. Untimed legacy services follow timed services. */
export function serviceDateTimeSortKey(service: Pick<Service, 'date' | 'time'>): string {
  return `${service.date}T${service.time || '99:99'}`
}

/** Combines a service's date and start time into a real local-timezone instant (ISO string),
 *  for the Countdown slide element's 'service' mode (see models/library.ts). Returns undefined
 *  when the service has no start time set — there's no meaningful instant to count down to. */
export function serviceDateTimeIso(service: Pick<Service, 'date' | 'time'>): string | undefined {
  const match = service.time?.match(/^(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const [year, month, day] = service.date.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day, Number(match[1]), Number(match[2])).toISOString()
}
