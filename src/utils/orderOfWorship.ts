import type { Service, ServiceItem } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'

export interface OrderOfWorshipLine {
  /** Bold label, e.g. "Scripture Reading:" — absent for a plain song line. */
  role?: string
  text: string
  person?: string
}

export interface OrderOfWorshipDoc {
  title: string
  dateLine: string
  /** "Piano — Marlene, Guitar — Jason, …" — undefined when no roster exists for this service. */
  volunteerLine?: string
  lines: OrderOfWorshipLine[]
}

function songLine(item: Extract<ServiceItem, { type: 'song' }>, songs: Map<string, Song>): OrderOfWorshipLine {
  const song = songs.get(item.songId)
  const number = song?.collections[0]?.number
  return { text: `${song?.title ?? 'Unknown song'}${number ? ` ${number}` : ''}`, person: item.person }
}

function slideRefLine(item: Extract<ServiceItem, { type: 'slide-ref' }>, slides: Map<string, SlideLibraryItem>): OrderOfWorshipLine {
  // A reusable slide library item's own label often *is* the bulletin line ("Welcome and
  // Announcements", "Silent Preparation") — the actual slide text isn't reproduced here,
  // matching a real printed bulletin rather than a full transcript of what's on screen.
  const slide = slides.get(item.slideId)
  return { role: slide?.label ?? 'Slide', text: '', person: item.person }
}

/**
 * One line per service item, in the order they already appear — "eliminates re-typing the
 * weekly bulletin from scratch" (feature-spec.md's Order of Worship section) since almost
 * everything needed is already in the service data.
 */
function buildLines(service: Service, songs: Map<string, Song>, slides: Map<string, SlideLibraryItem>): OrderOfWorshipLine[] {
  return service.items.map((item): OrderOfWorshipLine => {
    switch (item.type) {
      case 'song':
        return songLine(item, songs)
      case 'scripture':
        return { role: 'Scripture Reading:', text: item.reference, person: item.person }
      case 'slide-ref':
        return slideRefLine(item, slides)
      case 'text-slide':
        return { role: item.slides[0]?.label ?? 'Custom Slide', text: '', person: item.person }
      case 'media':
        return { text: '[Media]', person: item.person }
      case 'video':
        return { text: '[Video]', person: item.person }
      case 'audio':
        return { text: '[Audio]', person: item.person }
      case 'external-app':
        return { text: '[External App]', person: item.person }
      case 'countdown':
        return { text: item.text ?? '[Countdown]', person: item.person }
      case 'qr':
        return { text: item.caption ?? '[QR Code]', person: item.person }
    }
  })
}

/**
 * "Piano — Marlene, Guitar — Jason, …", tentative assignments marked with a trailing "?"
 * (feature-spec.md's Volunteer Roster section). Undefined (not an empty string) when there's
 * no roster at all, so the caller can fall back to the "add these manually" note.
 */
function buildVolunteerLine(service: Service, volunteerNames: Map<string, string>): string | undefined {
  const roster = service.volunteerRoster
  if (!roster || roster.length === 0) return undefined
  return roster
    .filter((assignment) => assignment.volunteerId)
    .map((assignment) => {
      const name = volunteerNames.get(assignment.volunteerId!) ?? 'Unassigned'
      return `${assignment.role} — ${name}${assignment.tentative ? '?' : ''}`
    })
    .join(', ')
}

export function buildOrderOfWorship(
  service: Service,
  songList: Song[],
  slideList: SlideLibraryItem[],
  volunteerNames: Map<string, string>,
): OrderOfWorshipDoc {
  const songs = new Map(songList.map((s) => [s.id, s]))
  const slides = new Map(slideList.map((s) => [s.id, s]))
  const dateLine = `${new Date(`${service.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })} · ${service.type}`

  return {
    title: 'Order of Worship',
    dateLine,
    volunteerLine: buildVolunteerLine(service, volunteerNames),
    lines: buildLines(service, songs, slides),
  }
}

export function toPlainText(doc: OrderOfWorshipDoc): string {
  const parts = [doc.title, doc.dateLine, '']
  if (doc.volunteerLine) parts.push(doc.volunteerLine, '')
  for (const line of doc.lines) {
    const label = line.role ? `${line.role} ` : ''
    const person = line.person ? ` — ${line.person}` : ''
    parts.push(`${label}${line.text}${person}`.trim())
  }
  return parts.join('\n')
}

export function toHtml(doc: OrderOfWorshipDoc): string {
  const lineHtml = doc.lines
    .map((line) => {
      const label = line.role ? `<strong>${escapeHtml(line.role)}</strong> ` : ''
      const person = line.person ? ` <em>${escapeHtml(line.person)}</em>` : ''
      return `<p>${label}${escapeHtml(line.text)}${person}</p>`
    })
    .join('\n')
  const volunteerHtml = doc.volunteerLine ? `<p>${escapeHtml(doc.volunteerLine)}</p>` : ''
  return (
    `<div style="font-family: Georgia, serif;">` +
    `<h2 style="text-align:center;margin-bottom:0;">${escapeHtml(doc.title)}</h2>` +
    `<p style="text-align:center;color:#555;margin-top:4px;">${escapeHtml(doc.dateLine)}</p>` +
    volunteerHtml +
    lineHtml +
    `</div>`
  )
}

function escapeHtml(value: string): string {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}
