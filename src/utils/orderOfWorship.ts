import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableBorders, TableCell, TableRow, TextRun, WidthType } from 'docx'
import type { Service, ServiceItem, RoleAssignment } from '@/models/service'
import type { Song } from '@/models/song'
import type { SlideLibraryItem } from '@/models/library'
import { formatServiceTime } from '@/utils/serviceTime'

export interface OrderOfWorshipLine {
  /** Bold label, e.g. "Scripture Reading:" — absent for a plain song line. */
  role?: string
  text: string
  person?: string
  /** An optional second line under this entry, e.g. "(after this song children up to grade 4
   *  can be dismissed to a children's lesson)" or a sermon's main passage reference. */
  note?: string
  /** The originating item's type — only used to decide spacing/separators (see
   *  `separatorBefore` below), so hand-built lines in tests are free to omit it. */
  kind?: ServiceItem['type']
  /** Whether a visual separator (and normal spacing) should precede this line when rendered.
   *  False only when this and the previous line are both songs, so a multi-song worship set
   *  reads as one flowing block instead of being chopped up by a divider/blank line between
   *  every single song — every other item boundary gets one. Always false for the first line. */
  separatorBefore?: boolean
}

export interface OrderOfWorshipDoc {
  title: string
  dateLine: string
  lines: OrderOfWorshipLine[]
}

// An item's "who's doing this" is a role name, not a Person id directly — the actual person is
// whoever that service's Assignments has for this role (RoleAssignment.personId), so assigning
// it there is what fills this in. Absent role (or no matching/unassigned RoleAssignment) means
// no one shows, same as before — e.g. a "Silent Preparation" bulletin note needs no one at all.
function resolveRolePerson(
  role: string | undefined,
  assignments: RoleAssignment[] | undefined,
  personNames: Map<string, string>,
): string | undefined {
  if (!role) return undefined
  const assignment = assignments?.find((a) => a.role === role)
  return assignment?.personId ? personNames.get(assignment.personId) : undefined
}

/** `bulletinLabel` always wins over a type's own default heading — this is what lets, e.g., a
 *  scripture item read "Scriptural Call to Worship:" instead of the hardcoded default, or a
 *  song (which has no default at all) get one like "Tithes and Offerings:". */
function roleFor(item: ServiceItem, defaultRole: string | undefined): string | undefined {
  return item.bulletinLabel ?? defaultRole
}

function songLine(
  item: Extract<ServiceItem, { type: 'song' }>,
  songs: Map<string, Song>,
  assignments: RoleAssignment[] | undefined,
  personNames: Map<string, string>,
): OrderOfWorshipLine {
  const song = songs.get(item.songId)
  const number = song?.collections[0]?.number
  return {
    role: roleFor(item, undefined),
    text: `${song?.title ?? 'Unknown song'}${number ? ` ${number}` : ''}`,
    person: resolveRolePerson(item.role, assignments, personNames),
    note: item.bulletinNote,
  }
}

function slideRefLine(
  item: Extract<ServiceItem, { type: 'slide-ref' }>,
  slides: Map<string, SlideLibraryItem>,
  assignments: RoleAssignment[] | undefined,
  personNames: Map<string, string>,
): OrderOfWorshipLine {
  // A reusable slide library item's own label often *is* the bulletin line ("Welcome and
  // Announcements", "Silent Preparation") — the actual slide text isn't reproduced here,
  // matching a real printed bulletin rather than a full transcript of what's on screen.
  const slide = slides.get(item.slideId)
  return {
    role: roleFor(item, slide?.label ?? 'Slide'),
    text: '',
    person: resolveRolePerson(item.role, assignments, personNames),
    note: item.bulletinNote,
  }
}

/**
 * One line per service item, in the order they already appear — "eliminates re-typing the
 * weekly bulletin from scratch" (feature-spec.md's Order of Worship section) since almost
 * everything needed is already in the service data.
 */
function buildLines(
  service: Service,
  songs: Map<string, Song>,
  slides: Map<string, SlideLibraryItem>,
  personNames: Map<string, string>,
): OrderOfWorshipLine[] {
  const assignments = service.assignments
  const lines = service.items.map((item): OrderOfWorshipLine => {
    const line = lineFor(item, songs, slides, assignments, personNames)
    return { ...line, kind: item.type }
  })
  // A pure post-pass (rather than computed inline above) since it needs to look at the
  // *previous* item's kind, which isn't available yet while still building the current line.
  return lines.map((line, index) => ({
    ...line,
    separatorBefore: index > 0 && !(line.kind === 'song' && lines[index - 1].kind === 'song'),
  }))
}

function lineFor(
  item: ServiceItem,
  songs: Map<string, Song>,
  slides: Map<string, SlideLibraryItem>,
  assignments: RoleAssignment[] | undefined,
  personNames: Map<string, string>,
): OrderOfWorshipLine {
  switch (item.type) {
      case 'song':
        return songLine(item, songs, assignments, personNames)
      case 'scripture':
        return {
          role: roleFor(item, 'Scripture Reading:'),
          text: item.reference,
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'slide-ref':
        return slideRefLine(item, slides, assignments, personNames)
      case 'text-slide':
        return {
          role: roleFor(item, item.slides[0]?.label ?? 'Custom Slide'),
          text: '',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'media':
        return {
          role: roleFor(item, undefined),
          text: '[Media]',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'video':
        return {
          role: roleFor(item, undefined),
          text: '[Video]',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'audio':
        return {
          role: roleFor(item, undefined),
          text: '[Audio]',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'external-app':
        return {
          role: roleFor(item, undefined),
          text: '[External App]',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'countdown':
        return {
          role: roleFor(item, undefined),
          text: item.text ?? '[Countdown]',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'qr':
        return {
          role: roleFor(item, undefined),
          text: item.caption ?? '[QR Code]',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'sermon': {
        // The sermon's own title (when set) is the heading — a real bulletin names the sermon,
        // not a generic "Worship Through the Word" label — with the main passage reference as
        // the line below it; an explicit bulletinNote (a deliberately typed note, distinct from
        // the title) still wins that second-line slot when someone's set one.
        const mainPassage = item.passages.find((p) => p.id === item.mainPassageId) ?? item.passages[0]
        return {
          role: roleFor(item, item.title ?? 'Worship Through the Word'),
          text: '',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote ?? mainPassage?.reference,
        }
      }
      case 'bulletin-note':
        return {
          role: roleFor(item, 'Note'),
          text: '',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
      case 'placeholder':
        return {
          role: roleFor(item, item.label),
          text: '(to be filled in)',
          person: resolveRolePerson(item.role, assignments, personNames),
          note: item.bulletinNote,
        }
  }
}

export function buildOrderOfWorship(
  service: Service,
  songList: Song[],
  slideList: SlideLibraryItem[],
  personNames: Map<string, string>,
): OrderOfWorshipDoc {
  const songs = new Map(songList.map((s) => [s.id, s]))
  const slides = new Map(slideList.map((s) => [s.id, s]))
  const dateLabel = new Date(`${service.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const timeLabel = formatServiceTime(service.time)
  const dateLine = `${dateLabel}${timeLabel ? ` · ${timeLabel}` : ''} · ${service.type}`

  return {
    title: 'Order of Worship',
    dateLine,
    lines: buildLines(service, songs, slides, personNames),
  }
}

export function toPlainText(doc: OrderOfWorshipDoc): string {
  const parts = [doc.title, doc.dateLine, '']
  for (const line of doc.lines) {
    // A blank line marks a real separator between items — skipped between consecutive songs
    // (see `separatorBefore`'s doc comment) so a multi-song worship set isn't broken up by gaps.
    if (line.separatorBefore) parts.push('')
    const label = line.role ? `${line.role} ` : ''
    const person = line.person ? ` — ${line.person}` : ''
    parts.push(`${label}${line.text}${person}`.trim())
    if (line.note) parts.push(line.note)
  }
  return parts.join('\n')
}

export function toHtml(doc: OrderOfWorshipDoc): string {
  const lineHtml = doc.lines
    .map((line) => {
      const label = line.role ? `<strong>${escapeHtml(line.role)}</strong> ` : ''
      const note = line.note ? `<p style="margin:0 0 6px 0;color:#555;">${escapeHtml(line.note)}</p>` : ''
      // Extra space between items (skipped between consecutive songs so a multi-song worship
      // set reads as one flowing block) — no visible rule/line, just spacing.
      const margin = line.separatorBefore ? '8px 0 2px 0' : '2px 0'
      // A table row (rather than float/flex) keeps the person's name reliably right-aligned
      // when this markup is pasted into email clients or opened in Word, both of which have
      // spotty CSS support.
      if (line.person) {
        return (
          `<table style="width:100%;border-collapse:collapse;margin:${margin};"><tr>` +
          `<td style="text-align:left;padding:0;">${label}${escapeHtml(line.text)}</td>` +
          `<td style="text-align:right;padding:0;white-space:nowrap;"><em>${escapeHtml(line.person)}</em></td>` +
          `</tr></table>${note}`
        )
      }
      return `<p style="margin:${margin};">${label}${escapeHtml(line.text)}</p>${note}`
    })
    .join('\n')
  return (
    `<div style="font-family: Georgia, serif;">` +
    `<h2 style="text-align:center;margin-bottom:0;">${escapeHtml(doc.title)}</h2>` +
    `<p style="text-align:center;color:#555;margin-top:4px;">${escapeHtml(doc.dateLine)}</p>` +
    lineHtml +
    `</div>`
  )
}

// One line's worth of paragraphs/table (the role/text (+ person, right-aligned via a borderless
// table row) and an optional note) — returned as an array since a single line can expand into
// up to two block-level children.
function docxLineBlocks(line: OrderOfWorshipLine): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = []
  // Extra space between items, skipped between consecutive songs — same rule as toHtml — so a
  // multi-song worship set reads as one flowing block instead of being visually chopped up.
  const spacingBefore = line.separatorBefore ? 120 : 0

  const mainRuns = [
    ...(line.role ? [new TextRun({ text: `${line.role} `, bold: true })] : []),
    ...(line.text ? [new TextRun({ text: line.text })] : []),
  ]
  if (line.person) {
    // A borderless table (rather than a tab stop) keeps the person's name reliably right-aligned
    // regardless of how long the role/text on the left runs — same reasoning as toHtml's table.
    blocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TableBorders.NONE,
        rows: [
          new TableRow({
            children: [
              new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: mainRuns, spacing: { before: spacingBefore } })] }),
              new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: line.person, italics: true })] })],
              }),
            ],
          }),
        ],
      }),
    )
  } else {
    blocks.push(new Paragraph({ children: mainRuns, spacing: { before: spacingBefore, after: 40 } }))
  }

  if (line.note) {
    blocks.push(new Paragraph({ children: [new TextRun({ text: line.note, italics: true, color: '888888', size: 18 })], spacing: { after: 40 } }))
  }
  return blocks
}

/**
 * A real .docx (OOXML) file — genuinely opens in Word, Google Docs, mobile Office apps, and
 * anything else that checks actual file contents, unlike the older "HTML saved with a .doc
 * extension" trick this used before. Built directly from the same OrderOfWorshipDoc/Line
 * structure toHtml/toPlainText use (including separatorBefore), rather than converting the HTML
 * output, so all three renderers stay in sync from one source of truth.
 */
export function toDocxBlob(doc: OrderOfWorshipDoc): Promise<Blob> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: doc.title })] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: doc.dateLine, color: '555555', size: 20 })],
          }),
          ...doc.lines.flatMap(docxLineBlocks),
        ],
      },
    ],
  })
  return Packer.toBlob(document)
}

function escapeHtml(value: string): string {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}
