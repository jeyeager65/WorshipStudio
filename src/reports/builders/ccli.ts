import type { CcliUsageSummary } from '@/utils/ccliUsage'
import type { DocumentReport, ReportBranding, ReportTableCell, WorkbookReport } from '../types'

export interface SongUsageReportInput {
  summary: CcliUsageSummary
  fromDate: string
  toDate: string
  serviceType: string
  branding: ReportBranding
}

export function buildSongUsageDocument(input: SongUsageReportInput): DocumentReport {
  const { summary, branding } = input
  const usageRows: ReportTableCell[][] = summary.rows.map((row) => [
    cell(row.title, true),
    cell(row.ccli ?? '—'),
    cell(row.author ?? '—'),
    cell(String(row.timesUsed), true, 'right'),
  ])

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
        headers: ['Song', 'CCLI #', 'Author', 'Uses'],
        rows: usageRows,
        widths: ['*', 90, '*', 55],
        headerRows: 1,
      },
    ],
  }
}

export function buildSongUsageWorkbook(input: SongUsageReportInput): WorkbookReport {
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
        columns: [
          { key: 'song', header: 'Song', width: 34 },
          { key: 'ccli', header: 'CCLI Number', width: 17 },
          { key: 'author', header: 'Author', width: 34 },
          { key: 'uses', header: 'Times Used', width: 14, numberFormat: '0' },
        ],
        rows: input.summary.rows.map((row) => ({
          song: row.title,
          ccli: row.ccli ?? '',
          author: row.author ?? '',
          uses: row.timesUsed,
        })),
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

function cell(
  text: string,
  bold = false,
  alignment: ReportTableCell['alignment'] = 'left',
): ReportTableCell {
  return { runs: [{ text, bold }], alignment }
}
