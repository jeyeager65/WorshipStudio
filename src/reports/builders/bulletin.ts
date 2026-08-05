import type { OrderOfWorshipDoc } from '@/utils/orderOfWorship'
import type { BulletinPage2Doc } from '@/utils/bulletinPage2'
import type { DocumentReport, ReportBlock, ReportBranding, ReportRun, ReportTableCell } from '../types'

// Printed on a black-and-white laser printer — every run gets this explicitly rather than
// relying on the shared renderers' own (colorful, brand-driven) style defaults. The overridden
// `branding` colors below (see buildBulletinDocument's return) cover the few places color still
// comes from the renderer itself (list headings, a non-plain table's header fill) rather than a
// run's own color.
const BLACK = '#000000'

// Every size below is exactly what was asked for, in points — deliberately not routed through
// the shared renderers' generic style-name-based sizing (title/subtitle/heading/body/note),
// which disagreed between the docx and PDF renderers anyway and had no way to express "16pt"
// precisely.
const FONT_PAGE_TITLE = 18 // "Order of Worship" / "Announcements" page titles
const FONT_DATE_LINE = 12 // the date under the Order of Worship title
const FONT_BODY = 12 // main font size — service lines, notes, list items, table cells
const FONT_SECTION_HEADING = 16 // "Upcoming" / "Announcements" list headings
const FONT_FOOTER = 14 // Heart Preparation / Thought to Ponder, title and content alike

function footerBlocks(footer: { title: string; text: string } | undefined): ReportBlock[] {
  if (!footer) return []
  return [
    {
      kind: 'paragraph',
      runs: [{ text: footer.title, underline: true, color: BLACK, fontSize: FONT_FOOTER }],
      alignment: 'center',
      spacingAfter: 2,
    },
    {
      kind: 'paragraph',
      runs: [{ text: footer.text, italics: true, color: BLACK, fontSize: FONT_FOOTER }],
      alignment: 'center',
    },
  ]
}

/** One name per line rather than a single comma-joined string — `names[0]` is the cell's first
 *  line, any further names become additional lines within the same cell (see
 *  ReportTableCell.extraLines). */
function namesCell(names: string[]): ReportTableCell {
  const [first, ...rest] = names
  return {
    runs: [{ text: first ?? '', color: BLACK, fontSize: FONT_BODY }],
    extraLines: rest.map((name) => [{ text: name, color: BLACK, fontSize: FONT_BODY }]),
  }
}

// A literal blank line between sections — a paragraph of a single space renders reliably as one
// blank line's worth of vertical space in both the docx and PDF renderers, unlike relying on
// each block kind's own (inconsistent) spacingBefore/spacingAfter to add up to the same effect.
function blankLine(): ReportBlock {
  return { kind: 'paragraph', runs: [{ text: ' ', color: BLACK, fontSize: FONT_BODY }] }
}

/** The date lead-in is bold, the announcement's own text is not — kept as two runs rather than
 *  one so only the date gets the emphasis. */
function upcomingItemRuns(line: { dateLabel?: string; text: string }): ReportRun[] {
  if (!line.dateLabel) return [{ text: line.text, color: BLACK, fontSize: FONT_BODY }]
  return [
    { text: `${line.dateLabel}: `, bold: true, color: BLACK, fontSize: FONT_BODY },
    { text: line.text, color: BLACK, fontSize: FONT_BODY },
  ]
}

function page2Blocks(page2: BulletinPage2Doc): ReportBlock[] {
  const blocks: ReportBlock[] = [
    {
      kind: 'paragraph',
      runs: [{ text: page2.title, bold: true, color: BLACK, fontSize: FONT_PAGE_TITLE }],
      alignment: 'center',
      spacingAfter: 12,
    },
  ]

  const hasUpcoming = page2.upcoming.length > 0
  if (hasUpcoming) {
    blocks.push({
      kind: 'list',
      heading: 'Upcoming',
      headingFontSize: FONT_SECTION_HEADING,
      headingColor: BLACK,
      items: page2.upcoming.map(upcomingItemRuns),
    })
  }

  if (page2.general.length > 0) {
    if (hasUpcoming) blocks.push(blankLine())
    blocks.push({
      kind: 'list',
      heading: 'Announcements',
      headingFontSize: FONT_SECTION_HEADING,
      headingColor: BLACK,
      items: page2.general.map((line): ReportRun[] => [
        { text: line.text, color: BLACK, fontSize: FONT_BODY },
      ]),
    })
  }

  if (page2.servingSchedule) {
    blocks.push(blankLine())
    blocks.push({
      kind: 'table',
      plainHeader: true,
      headerFontSize: FONT_BODY,
      headers: page2.servingSchedule.headers,
      rows: page2.servingSchedule.rows.map((row) => [
        { runs: [{ text: row.role, bold: true, color: BLACK, fontSize: FONT_BODY }] },
        namesCell(row.thisWeek),
        namesCell(row.nextWeek),
      ]),
    })
  }

  return blocks
}

export function buildBulletinDocument(
  doc: OrderOfWorshipDoc,
  branding: ReportBranding,
  serviceDate?: string,
  page2?: BulletinPage2Doc,
): DocumentReport {
  const blocks: ReportBlock[] = []

  for (const line of doc.lines) {
    const runs: ReportRun[] = [
      ...(line.role ? [{ text: `${line.role} `, bold: true, color: BLACK, fontSize: FONT_BODY }] : []),
      ...(line.text ? [{ text: line.text, color: BLACK, fontSize: FONT_BODY }] : []),
    ]

    if (line.person) {
      blocks.push({
        kind: 'columns',
        columns: [
          { width: '*', blocks: [{ kind: 'paragraph', runs }] },
          {
            width: 150,
            blocks: [
              {
                kind: 'paragraph',
                runs: [{ text: line.person, italics: true, color: BLACK, fontSize: FONT_BODY }],
                alignment: 'right',
              },
            ],
          },
        ],
        gap: 12,
      })
    } else {
      blocks.push({
        kind: 'paragraph',
        runs,
        spacingBefore: line.separatorBefore ? 8 : 1,
        spacingAfter: 1,
      })
    }

    if (line.note) {
      blocks.push({
        kind: 'paragraph',
        runs: [{ text: line.note, italics: true, color: BLACK, fontSize: FONT_BODY }],
        spacingAfter: 3,
      })
    }
  }

  const firstColumn = {
    width: '*' as const,
    blocks: [
      {
        kind: 'paragraph' as const,
        runs: [{ text: doc.title, bold: true, color: BLACK, fontSize: FONT_PAGE_TITLE }],
        alignment: 'center' as const,
        spacingAfter: 4,
      },
      {
        kind: 'paragraph' as const,
        runs: [{ text: doc.dateLine, color: BLACK, fontSize: FONT_DATE_LINE }],
        alignment: 'center' as const,
        spacingAfter: 16,
      },
      ...blocks,
    ],
  }

  // A church that's turned the whole second page off (Settings → Bulletin) gets a plain
  // single-column document instead of a column with nothing in it.
  const columns = page2
    ? [firstColumn, { width: '*' as const, blocks: page2Blocks(page2) }]
    : [firstColumn]

  // Footers are pinned to the page bottom via each renderer's own native mechanism (see
  // DocumentReport.pageFooterColumns), not appended as regular flowing content — that's what
  // makes them land at the bottom regardless of how much content is above them. Laid out with
  // the same column shape as `columns` above so each footer aligns under its own page.
  const footerColumns = [
    { width: '*' as const, blocks: footerBlocks(doc.footer) },
    ...(page2 ? [{ width: '*' as const, blocks: footerBlocks(page2.footer) }] : []),
  ]
  const hasAnyFooter = footerColumns.some((column) => column.blocks.length > 0)

  return {
    title: doc.title,
    subtitle: doc.dateLine,
    showTitle: false,
    showHeaderFooter: false,
    subject: 'Service bulletin and order of worship',
    filenameBase: `Bulletin - ${serviceDate ?? filenameDate(doc.dateLine)} (Classic)`,
    // Every run above is explicitly black already — this override only matters for the few
    // spots color still comes from the renderer itself (list headings default to the branding
    // primary color unless told otherwise, as here) rather than a run's own color.
    branding: { ...branding, primaryColor: BLACK, secondaryColor: BLACK },
    orientation: 'landscape',
    blocks: [
      {
        kind: 'columns',
        gap: 36,
        columns,
      },
    ],
    pageFooterColumns: hasAnyFooter ? footerColumns : undefined,
  }
}

function filenameDate(dateLine: string): string {
  return dateLine.split(' · ')[0] || 'Service'
}
