import type { Column, Content, ContentTable, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { OrderOfWorshipDoc, OrderOfWorshipLine } from '@/utils/orderOfWorship'
import type { BulletinPage2Doc } from '@/utils/bulletinPage2'
import type { ReportBranding } from './types'
import {
  iconPeople,
  iconHeart,
  iconBook,
  iconMusic,
  iconPrayer,
  iconCross,
  iconGift,
  iconCandle,
  iconThought,
  iconAnnounce,
  iconGeneric,
  plainIconCalendar,
  plainIconAnnounce,
  plainIconGreeting,
  plainIconVolume,
  plainIconCradle,
  plainIconAccount,
} from './modernBulletinIcons'

// Monochrome throughout (this prints on a black-and-white laser printer) — "ink" for the main
// text, "muted" for secondary/italic text and rules, nothing else.
const INK = '#000000'
const MUTED = '#555555'
const HAIRLINE = '#B3B3B3'
// A touch darker than HAIRLINE — used only for the serving-schedule table's between-row rules,
// so they read as distinct from the rest of the page's own hairlines.
const TABLE_RULE = '#999999'

// Landscape LETTER (792x612pt) minus this style's own margins and the gap between the two
// columns — the same single-sheet, two-column shape as the "Classic" bulletin (see
// builders/bulletin.ts), just with this style's own decorative treatment.
const SIDE_MARGIN = 21.6 // 0.3in
const TOP_MARGIN = 28.8 // 0.4in
// Generous on purpose: this has to hold the pinned footer (see buildFooter) — its hairline/icon
// row, title, and up to a couple of lines of quote text — not just a body-content breathing gap.
const BOTTOM_MARGIN = 90
const COLUMN_GAP = 32
const COLUMN_WIDTH = (792 - SIDE_MARGIN * 2 - COLUMN_GAP) / 2

/**
 * A second, more decorative bulletin style — inspired by a real example the user shared: an
 * icon badge per line, hairline dividers, small-caps section labels. PDF-only by design: the
 * icon badges, precise hairlines, and letter-spaced headings it depends on have no reasonable
 * equivalent in Word (see the shared ReportBlock system's docx renderer, which this deliberately
 * bypasses) — the "Classic" style already covers Word. Built directly against pdfmake rather
 * than the generic ReportBlock/DocumentReport builders elsewhere in this folder, since nothing
 * here is portable across formats.
 */
export async function renderModernBulletin(
  doc: OrderOfWorshipDoc,
  page2: BulletinPage2Doc | undefined,
  branding: ReportBranding,
): Promise<Uint8Array> {
  const [pdfMakeModule, vfsModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const pdfMake = pdfMakeModule.default
  pdfMake.addVirtualFileSystem(vfsModule.default)

  const firstColumn: Column = {
    width: '*',
    stack: [
      ...decorativeHeader(doc.title),
      ...uppercaseDateLine(doc.dateLine),
      { text: '', margin: [0, 3, 0, 0] },
      ...lineGroups(doc.lines).flatMap((group, index, groups) =>
        renderGroup(group, index === groups.length - 1),
      ),
    ],
  }

  const footerContent = buildFooter(doc.footer, page2?.footer, !!page2)

  const definition: TDocumentDefinitions = {
    info: { title: doc.title, author: branding.churchName, creator: 'Worship Studio' },
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [SIDE_MARGIN, TOP_MARGIN, SIDE_MARGIN, BOTTOM_MARGIN],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: INK, lineHeight: 1.0 },
    content: [
      {
        // No page2 (a church with the back page turned off) gets a plain single column instead
        // of a column with nothing beside it — matches the Classic builder's own fallback.
        columns: page2 ? [firstColumn, { width: '*', stack: page2Content(page2) }] : [firstColumn],
        columnGap: COLUMN_GAP,
      },
    ],
    ...(footerContent ? { footer: () => footerContent } : {}),
  }

  const buffer = await pdfMake.createPdf(definition).getBuffer()
  return new Uint8Array(buffer)
}

// A plain `canvas` line loses its position and drifts to the page's own top-left origin when
// used inside a `columns` row — a real pdfmake quirk (only `svg` content respects its column's
// offset; the icon badges elsewhere in this file already rely on that). Every hairline that
// needs to sit *beside* something else (a title, a cross, an icon) is therefore drawn as SVG;
// hairline() below (canvas-based) stays reserved for standalone use between line items, where it
// renders correctly on its own.
function hairlineSvg(width: number): string {
  return `<svg width="${width}" height="2" viewBox="0 0 ${width} 2"><line x1="0" y1="1" x2="${width}" y2="1" stroke="${HAIRLINE}" stroke-width="1"/></svg>`
}

// An earlier version made this column flexible (`width: '*'`) and relied on pdfmake's
// `alignment: 'right'/'left'` to pin the hairline against whatever it's flanking. That path
// turned out to be unreliable this deep in nested columns — inspecting the actual generated
// PDF's content stream showed `alignment`'s offset being computed against the wrong available
// width, leaving the two sides of a supposedly-symmetric row measurably different by several
// points. Giving the column a single, exactly-known fixed width instead (equal to the hairline's
// own drawn width) sidesteps that entirely: there's no flex space left for any alignment
// calculation to get wrong, so both flanks are trivially, deterministically identical.
function hairlineColumn(width: number, marginTop: number): Column {
  return { width, margin: [0, marginTop, 0, 0], svg: hairlineSvg(width), fit: [width, 2] }
}

const PLAIN_CROSS_SVG = `<svg width="12" height="14" viewBox="0 0 12 14"><g stroke="${MUTED}" stroke-width="1.4" stroke-linecap="round"><line x1="6" y1="0" x2="6" y2="14"/><line x1="0" y1="5" x2="12" y2="5"/></g></svg>`

function hairline(width = COLUMN_WIDTH, marginLeft = 0, marginBottom = 0): Content {
  return {
    canvas: [
      { type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.75, lineColor: HAIRLINE },
    ],
    margin: [marginLeft, 0, 0, marginBottom],
  }
}

// Each flank runs the rest of the way to the column's own edge — the cross (12pt) plus its two
// gaps (12pt each) are the only other fixed width in this row, so what's left splits evenly
// between the two flanking hairlines, filling the column exactly.
const HEADER_HAIRLINE_WIDTH = (COLUMN_WIDTH - 12 - 24) / 2

function decorativeHeader(title: string): Content[] {
  return [
    {
      columns: [
        hairlineColumn(HEADER_HAIRLINE_WIDTH, 6),
        { width: 12, svg: PLAIN_CROSS_SVG, fit: [12, 14] },
        hairlineColumn(HEADER_HAIRLINE_WIDTH, 6),
      ],
      columnGap: 12,
    },
    {
      text: title.toUpperCase(),
      alignment: 'center',
      bold: true,
      fontSize: 18,
      characterSpacing: 1.2,
      margin: [0, 7, 0, 5],
    },
  ]
}

function uppercaseDateLine(dateLine: string): Content[] {
  return [
    {
      // Blank `'*'` spacers on both outer edges, rather than relying on `alignment` to center the
      // whole row (that path measures against the wrong available width this deep in nested
      // columns — see hairlineColumn's own comment) or wrapping the row in an extra `width:
      // 'auto'` column (found to silently drop content when its own content is itself a nested
      // `columns` block). A flat row of blank-spacer / hairline / text / hairline / blank-spacer
      // centers the compact group reliably because the two spacers, having no alignment-sensitive
      // content of their own, always split the leftover space exactly evenly.
      columns: [
        { width: '*', text: '' },
        hairlineColumn(30, 4),
        {
          width: 'auto',
          text: dateLine.toUpperCase(),
          alignment: 'center',
          bold: true,
          fontSize: 9,
          characterSpacing: 1.2,
          color: MUTED,
        },
        hairlineColumn(30, 4),
        { width: '*', text: '' },
      ],
      columnGap: 6,
    },
  ]
}

/** Which badge best matches a line's meaning. `kind` alone only distinguishes broad content
 *  types (song/scripture/sermon/...); most liturgy lines are generic "bulletin-note" items whose
 *  real meaning lives in their own label text (e.g. "Silent Preparation" vs "Prayer of Praise
 *  and Confession"), so this also does simple keyword matching against that label. */
function iconForLine(line: OrderOfWorshipLine): string {
  const label = (line.role ?? '').toLowerCase()
  if (line.kind === 'song') return iconMusic
  if (line.kind === 'sermon') return iconCross
  if (label.includes('announce')) return iconAnnounce
  if (label.includes('welcome')) return iconPeople
  if (label.includes('reflect')) return iconCandle
  if (label.includes('silent') || label.includes('prepar')) return iconHeart
  if (label.includes('prayer')) return iconPrayer
  if (label.includes('offering') || label.includes('tithe')) return iconGift
  if (
    line.kind === 'scripture' ||
    label.includes('scripture') ||
    label.includes('call to worship')
  ) {
    return iconBook
  }
  return iconGeneric
}

function stripTrailingColon(text: string): string {
  return text.replace(/:\s*$/, '')
}

interface LineGroup {
  icon: string
  first: OrderOfWorshipLine
  /** Additional song titles folded into this same row — matches how a multi-song worship set
   *  already reads as one flowing block elsewhere (see separatorBefore's own doc comment). */
  extraSongTexts: string[]
}

function lineGroups(lines: OrderOfWorshipLine[]): LineGroup[] {
  const groups: LineGroup[] = []
  for (const line of lines) {
    const isSongContinuation =
      line.kind === 'song' && line.separatorBefore === false && groups.length > 0
    if (isSongContinuation) {
      groups[groups.length - 1]!.extraSongTexts.push(line.text)
      continue
    }
    groups.push({ icon: iconForLine(line), first: line, extraSongTexts: [] })
  }
  return groups
}

const ICON_COLUMN_WIDTH = 28
const ROW_COLUMN_GAP = 10
// Where the divider (and the row's own text content) starts — right after the icon column and
// its gap. Used to size the divider so its total footprint (this inset + its own drawn width)
// lands exactly on the column's right edge instead of past it: an earlier version subtracted only
// ICON_COLUMN_WIDTH here, overshooting the column's true width by the row's own columnGap (10pt)
// on every single divider — discovered by inspecting the actual PDF content stream, where it was
// silently forcing the whole first page-column to grow at the second column's expense.
const LINE_DIVIDER_INSET = ICON_COLUMN_WIDTH + ROW_COLUMN_GAP

function renderGroup(group: LineGroup, isLast: boolean): Content[] {
  const { first, extraSongTexts } = group
  const roleText = first.role ? stripTrailingColon(first.role).toUpperCase() : undefined

  const titleLine: Content = {
    columns: [
      {
        width: '*',
        text: [
          ...(roleText ? [{ text: roleText, bold: true, fontSize: 10 }] : []),
          ...(first.text
            ? [{ text: `${roleText ? '   ' : ''}${first.text}`, italics: !!roleText, fontSize: 10 }]
            : []),
        ],
      },
      ...(first.person
        ? [{ width: 'auto' as const, text: first.person, italics: true, fontSize: 9, color: MUTED }]
        : []),
    ],
  }

  // A row with only its title line is shorter than the fixed 20pt icon beside it, so pdfmake's
  // default top-aligned columns leave it sitting high with empty space below. Nudging just this
  // single-line case down by half the icon/text height difference centers it against the icon;
  // rows with extra song lines or a note are already taller than the icon on their own, so they
  // stay top-aligned (unchanged) rather than getting pushed needlessly further down.
  const isSingleLine = extraSongTexts.length === 0 && !first.note
  const textColumnMarginTop = isSingleLine ? 4.5 : 0

  const row: Content = {
    columns: [
      { width: ICON_COLUMN_WIDTH, svg: group.icon, fit: [20, 20] },
      {
        width: '*',
        margin: [0, textColumnMarginTop, 0, 0] as [number, number, number, number],
        stack: [
          titleLine,
          ...extraSongTexts.map((text): Content => ({ text, fontSize: 10, margin: [0, 1, 0, 0] })),
          ...(first.note
            ? [
                {
                  text: first.note,
                  italics: true,
                  fontSize: 9,
                  color: MUTED,
                  margin: [0, 1, 0, 0],
                } as Content,
              ]
            : []),
        ],
      },
    ],
    columnGap: ROW_COLUMN_GAP,
    margin: [0, 4, 0, 4] as [number, number, number, number],
  }

  return isLast ? [row] : [row, hairline(COLUMN_WIDTH - LINE_DIVIDER_INSET, LINE_DIVIDER_INSET)]
}

// The icon sits in a 16pt-tall box starting at its row's own top (no margin), so its visual
// center lands at y=8. The hairline is only 2pt tall, so its center is just `marginTop + 1` —
// matching that requires marginTop=7, not the 3 an earlier version used (which put the hairline
// noticeably above the icon's center instead of level with it).
const FOOTER_HAIRLINE_MARGIN_TOP = 7

function footerIcon(title: string): string {
  const lower = title.toLowerCase()
  if (lower.includes('heart')) return iconHeart
  if (lower.includes('thought')) return iconThought
  return iconGeneric
}

function footerBlock(footer: { title: string; text: string }): Content[] {
  const icon = footerIcon(footer.title)
  return [
    {
      // Same blank-spacer centering trick as uppercaseDateLine — see its own comment.
      columns: [
        { width: '*', text: '' },
        hairlineColumn(60, FOOTER_HAIRLINE_MARGIN_TOP),
        { width: 20, svg: icon, fit: [16, 16] },
        hairlineColumn(60, FOOTER_HAIRLINE_MARGIN_TOP),
        { width: '*', text: '' },
      ],
      columnGap: 6,
    },
    {
      text: footer.title.toUpperCase(),
      alignment: 'center',
      bold: true,
      fontSize: 10,
      characterSpacing: 1.2,
      margin: [0, 4, 0, 3],
    },
    { text: footer.text, alignment: 'center', italics: true, fontSize: 10, color: INK },
  ]
}

/** Pins both footer quotes to the true bottom of the page via pdfmake's own `footer` slot,
 *  laid out in the same two-column shape as the main content above it, rather than flowing them
 *  as regular content at the end of each column's stack (where they'd land wherever that
 *  column's content happened to end, not at a consistent, bottom-anchored spot). `undefined`
 *  when neither footer has anything to show, so the definition can skip the `footer` property
 *  entirely rather than reserving space for nothing. */
function buildFooter(
  page1Footer: { title: string; text: string } | undefined,
  page2Footer: { title: string; text: string } | undefined,
  hasPage2: boolean,
): Content | undefined {
  if (!page1Footer && !page2Footer) return undefined
  const firstColumn: Column = { width: '*', stack: page1Footer ? footerBlock(page1Footer) : [] }
  return {
    margin: [SIDE_MARGIN, 0, SIDE_MARGIN, 16],
    columns: hasPage2
      ? [firstColumn, { width: '*', stack: page2Footer ? footerBlock(page2Footer) : [] }]
      : [firstColumn],
    columnGap: COLUMN_GAP,
  }
}

// An icon-prefixed section subtitle, matching the bold/uppercase/letter-spaced treatment the
// plain-text subtitles already used — just with a small MDI glyph in the same row instead of a
// bare heading. marginTop=1 on the icon column nudges its 11pt glyph down to sit level with the
// bold text's cap-height rather than its (taller) line-height box.
function sectionHeading(icon: string, label: string, marginTop: number): Content {
  return {
    columns: [
      { width: 13, svg: icon, fit: [11, 11], margin: [0, 1, 0, 0] },
      { width: 'auto', text: label, bold: true, fontSize: 11, characterSpacing: 1 },
    ],
    columnGap: 5,
    margin: [0, marginTop, 0, 4],
  }
}

/** Which icon best matches a serving-schedule role name. */
function iconForRole(role: string): string {
  const lower = role.toLowerCase()
  if (lower.includes('greet')) return plainIconGreeting
  if (lower.includes('sound')) return plainIconVolume
  if (lower.includes('nursery') || lower.includes('baby')) return plainIconCradle
  return plainIconAccount
}

function roleCell(role: string): Content {
  return {
    columns: [
      { width: 12, svg: iconForRole(role), fit: [11, 11] },
      { width: '*', text: role.toUpperCase(), bold: true, fontSize: 9 },
    ],
    columnGap: 4,
    margin: [0, 2, 0, 2],
  }
}

// Deliberately drawn as a tiny SVG dot rather than pdfmake's built-in `ul` list type — `ul`'s
// marker glyph scales with fontSize and reads as a fairly large disc even at 10pt, whereas these
// upcoming/announcement items want a small, understated bullet. Sized to the same 13pt column +
// 5pt gap as sectionHeading's own icon column, so item text lines up under the subtitle's text,
// with the dot itself centered in that column (margin-left 4.5 = (13-4)/2). marginTop=4.5 centers
// the 4pt dot against the first line of text beside it (confirmed against a rendered sample — a
// plain top offset of 3 sat visibly high, above the text's own cap-height).
const BULLET_SVG = `<svg width="4" height="4" viewBox="0 0 4 4" xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="2" fill="${MUTED}"/></svg>`
const BULLET_COLUMN_WIDTH = 13
const BULLET_COLUMN_GAP = 5

function bulletLine(text: string | Content[]): Content {
  return {
    columns: [
      { width: BULLET_COLUMN_WIDTH, svg: BULLET_SVG, fit: [4, 4], margin: [4.5, 4.5, 0, 0] },
      { width: '*', text },
    ],
    columnGap: BULLET_COLUMN_GAP,
    margin: [0, 0, 0, 6],
  }
}

// Sits directly beneath each right-column subtitle (UPCOMING/ANNOUNCEMENTS/SERVING SCHEDULE),
// separating the heading from its own content — same hairline as renderGroup's between-item
// dividers, just full column width since there's no icon column here to inset past.
function subtitleDivider(): Content {
  return hairline(COLUMN_WIDTH, 0, 5)
}

function page2Content(page2: BulletinPage2Doc): Content[] {
  const blocks: Content[] = [...decorativeHeader(page2.title)]

  const hasUpcoming = page2.upcoming.length > 0
  if (hasUpcoming) {
    blocks.push(sectionHeading(plainIconCalendar, 'UPCOMING', 8))
    blocks.push(subtitleDivider())
    for (const line of page2.upcoming) {
      blocks.push(
        bulletLine([
          ...(line.dateLabel ? [{ text: `${line.dateLabel}:  `, bold: true, fontSize: 10 }] : []),
          { text: line.text, fontSize: 10 },
        ]),
      )
    }
  }

  if (page2.general.length > 0) {
    blocks.push(sectionHeading(plainIconAnnounce, 'ANNOUNCEMENTS', hasUpcoming ? 12 : 8))
    blocks.push(subtitleDivider())
    for (const line of page2.general) {
      blocks.push(bulletLine([{ text: line.text, fontSize: 10 }]))
    }
  }

  // Only gets the larger gap when UPCOMING actually ran above it — otherwise (Upcoming absent)
  // this sits right under Announcements' own already-standard spacing, same as before.
  if (page2.servingSchedule) {
    blocks.push(sectionHeading(plainIconAccount, 'SERVING SCHEDULE', hasUpcoming ? 12 : 9))
    blocks.push(subtitleDivider())
    blocks.push({
      margin: [6, 0, 0, 0],
      table: {
        headerRows: 1,
        widths: [95, '*', '*'],
        body: [
          // The "Role" label itself is dropped — the Role column's own icons (see roleCell)
          // already make each row's meaning clear without a repeated column header.
          page2.servingSchedule.headers.map((header, index) => ({
            text: index === 0 ? '' : header.toUpperCase(),
            bold: true,
            fontSize: 9,
            margin: [0, 2, 0, 2] as [number, number, number, number],
          })),
          // Same treatment as a left-column line's own assigned-person text (see renderGroup's
          // titleLine) — italic and muted, since these cells are also just naming who's serving.
          ...page2.servingSchedule.rows.map((row) => [
            roleCell(row.role),
            {
              text: row.thisWeek.join('\n'),
              italics: true,
              fontSize: 9,
              color: MUTED,
              margin: [0, 2, 0, 2] as [number, number, number, number],
            },
            {
              text: row.nextWeek.join('\n'),
              italics: true,
              fontSize: 9,
              color: MUTED,
              margin: [0, 2, 0, 2] as [number, number, number, number],
            },
          ]),
        ],
      },
      // No column borders, no shading — just a thin rule under the header and between each data
      // row, stopping short of the table's own outer top/bottom edge.
      layout: {
        vLineWidth: () => 0,
        hLineWidth: (i: number, node: ContentTable) =>
          i > 0 && i < node.table.body.length ? 0.5 : 0,
        hLineColor: () => TABLE_RULE,
      },
    })
  }

  return blocks
}
