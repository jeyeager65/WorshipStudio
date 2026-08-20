import type { SongUsageSummary } from '@/utils/songUsageReport'
import type {
  DocumentReport,
  ReportBranding,
  ReportTableCell,
  WorkbookColumn,
  WorkbookReport,
} from '../types'

export interface SongUsageReportInput {
  summary: SongUsageSummary
  fromDate: string
  toDate: string
  serviceType: string
  branding: ReportBranding
}

export function buildSongUsageDocument(input: SongUsageReportInput): DocumentReport {
  const { summary, branding } = input
  const showCcli = hasAnyCcli(summary)
  const usageRows: ReportTableCell[][] = summary.rows.map((row) => {
    const cells = [cell(row.title, true)]
    if (showCcli) cells.push(cell(row.ccli ?? '—'))
    cells.push(cell(row.author ?? '—'))
    cells.push(cell(String(row.timesUsed), true, 'right'))
    cells.push(cell(datesUsedText(row.dates, input)))
    return cells
  })

  const headers = ['Song']
  const widths: Array<number | '*'> = ['*']
  if (showCcli) {
    headers.push('CCLI #')
    widths.push(70)
  }
  headers.push('Author', 'Uses', 'Dates Used')
  widths.push('*', 40, '*')

  return {
    title: 'Song Usage Report',
    subtitle: reportSubtitle(input),
    subject: 'Song usage across services',
    filenameBase: `Song Usage - ${input.fromDate} to ${input.toDate}`,
    orientation: 'portrait',
    branding,
    blocks: [
      {
        kind: 'table',
        headers: ['Total Song Uses', 'Unique Songs', 'Services Included'],
        rows: [
          [
            cell(String(summary.totalUses), true, 'center'),
            cell(String(summary.uniqueSongs), true, 'center'),
            cell(String(summary.servicesIncluded), true, 'center'),
          ],
        ],
        widths: ['*', '*', '*'],
      },
      {
        kind: 'paragraph',
        runs: [{ text: 'Song usage detail', bold: true }],
        style: 'heading',
        spacingBefore: 16,
        spacingAfter: 6,
      },
      {
        kind: 'table',
        headers,
        rows: usageRows,
        widths,
        headerRows: 1,
      },
    ],
  }
}

export function buildSongUsageWorkbook(input: SongUsageReportInput): WorkbookReport {
  const showCcli = hasAnyCcli(input.summary)
  const columns: WorkbookColumn[] = [{ key: 'song', header: 'Song', width: 34 }]
  if (showCcli) columns.push({ key: 'ccli', header: 'CCLI Number', width: 17 })
  columns.push(
    { key: 'author', header: 'Author', width: 34 },
    { key: 'uses', header: 'Times Used', width: 14, numberFormat: '0' },
    { key: 'dates', header: 'Dates Used', width: 30 },
  )

  return {
    filenameBase: `Song Usage - ${input.fromDate} to ${input.toDate}`,
    branding: input.branding,
    sheets: [
      {
        name: 'Usage',
        title: 'Song Usage Report',
        subtitle: reportSubtitle(input),
        freezeHeader: true,
        autoFilter: true,
        columns,
        rows: input.summary.rows.map((row) => {
          const record: Record<string, string | number> = { song: row.title }
          if (showCcli) record.ccli = row.ccli ?? ''
          record.author = row.author ?? ''
          record.uses = row.timesUsed
          record.dates = row.dates.map((date) => formatDateUsed(date, input)).join('\n')
          return record
        }),
      },
      {
        name: 'Report Info',
        title: 'Report Information',
        columns: [
          { key: 'field', header: 'Field', width: 24 },
          { key: 'value', header: 'Value', width: 42 },
        ],
        rows: [
          { field: 'Church', value: input.branding.churchName },
          { field: 'Start Date', value: input.fromDate },
          { field: 'End Date', value: input.toDate },
          {
            field: 'Service Type',
            value: input.serviceType === 'all' ? 'All Types' : input.serviceType,
          },
          { field: 'Total Song Uses', value: input.summary.totalUses },
          { field: 'Unique Songs', value: input.summary.uniqueSongs },
          { field: 'Services Included', value: input.summary.servicesIncluded },
          { field: 'Generated', value: new Date() },
        ],
      },
    ],
  }
}

/** Whether the "CCLI #" column earns its place — omitted entirely (not just left blank per row)
 *  when nothing in this particular result set has a CCLI number set, since a whole column of
 *  em-dashes is just noise for a church that doesn't track them yet. */
function hasAnyCcli(summary: SongUsageSummary): boolean {
  return summary.rows.some((row) => row.ccli)
}

function reportSubtitle(input: SongUsageReportInput): string {
  const type = input.serviceType === 'all' ? 'All service types' : input.serviceType
  return `${formatDate(input.fromDate)} – ${formatDate(input.toDate)} · ${type}`
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Whether `fromDate` and `toDate` (both "YYYY-MM-DD") fall in different calendar years —
 *  decides whether each "Dates Used" entry needs its own year spelled out or can drop it as
 *  redundant with the report's own date range. */
function spansMultipleYears(input: Pick<SongUsageReportInput, 'fromDate' | 'toDate'>): boolean {
  return input.fromDate.slice(0, 4) !== input.toDate.slice(0, 4)
}

/** MM/DD/YYYY, or just MM/DD when the whole report range is within one calendar year — plain
 *  string slicing rather than a `Date` round-trip, so this can't drift by a day the way
 *  `toISOString()`-based formatting can near a timezone boundary (dates here are already plain
 *  "YYYY-MM-DD" calendar dates with no timezone semantics to begin with). */
function formatDateUsed(value: string, input: Pick<SongUsageReportInput, 'fromDate' | 'toDate'>): string {
  const [year, month, day] = value.split('-')
  return spansMultipleYears(input) ? `${month}/${day}/${year}` : `${month}/${day}`
}

// Comma-joined into the cell's single line (rather than one-per-line via ReportTableCell's
// extraLines, the convention bulletin.ts's namesCell uses for a handful of names) — a
// frequently-used song can rack up many dates within a report's range, and letting the table's
// normal text wrapping handle that reads better than a row that grows extremely tall.
function datesUsedText(dates: string[], input: Pick<SongUsageReportInput, 'fromDate' | 'toDate'>): string {
  return dates.length ? dates.map((date) => formatDateUsed(date, input)).join(', ') : '—'
}

function cell(
  text: string,
  bold = false,
  alignment: ReportTableCell['alignment'] = 'left',
): ReportTableCell {
  return { runs: [{ text, bold }], alignment }
}
