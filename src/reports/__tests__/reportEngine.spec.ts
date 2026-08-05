import { describe, expect, it } from 'vitest'
import { buildSongUsageDocument, buildSongUsageWorkbook } from '@/reports/builders/ccli'
import { buildPlanningDocument, buildPlanningWorkbook } from '@/reports/builders/planning'
import { buildBulletinDocument } from '@/reports/builders/bulletin'
import { renderDocx } from '@/reports/renderers/docx'
import { renderPdf } from '@/reports/renderers/pdf'
import { renderXlsx } from '@/reports/renderers/xlsx'
import ExcelJS from 'exceljs'

const branding = {
  churchName: 'Grace Church',
  primaryColor: '#315EA8',
  secondaryColor: '#B08D3F',
}

const songUsageInput = {
  branding,
  fromDate: '2026-01-01',
  toDate: '2026-07-31',
  serviceType: 'all',
  summary: {
    totalUses: 4,
    uniqueSongs: 2,
    servicesIncluded: 2,
    rows: [
      { songId: 's1', title: 'Amazing Grace', ccli: '22025', author: 'John Newton', timesUsed: 3 },
      { songId: 's2', title: 'Doxology', author: 'Thomas Ken', timesUsed: 1 },
    ],
  },
}

const planningInput = {
  branding,
  fromDate: '2026-08-01',
  toDate: '2026-08-31',
  serviceType: 'all',
  rows: [
    {
      serviceId: 'service-1',
      date: '2026-08-02',
      dateLine: 'Sun, Aug 2, 2026 · 10:30 AM',
      type: 'Morning Worship',
      preacher: 'Pastor Dan',
      sermonTitle: 'Hope in Christ',
      songTitles: ['Amazing Grace', 'Doxology'],
      rosterGroups: [
        {
          category: 'Praise Team',
          assignments: [{ role: 'Piano', person: 'Kelly', tentative: false }],
        },
        {
          category: 'Building',
          assignments: [{ role: 'Opening', person: 'James', tentative: false }],
        },
      ],
    },
  ],
}

describe('report builders', () => {
  it('uses the general Song Usage identity while retaining CCLI fields', () => {
    const document = buildSongUsageDocument(songUsageInput)
    const workbook = buildSongUsageWorkbook(songUsageInput)

    expect(document.title).toBe('Song Usage Report')
    expect(document.orientation).toBe('portrait')
    expect(document.filenameBase).toContain('Song Usage')
    expect(workbook.sheets[0].columns.map((column) => column.header)).toContain('CCLI Number')
  })

  it('creates document and workbook forms of the multi-week plan', () => {
    const document = buildPlanningDocument(planningInput)
    const workbook = buildPlanningWorkbook(planningInput)

    expect(document.blocks[0]).toMatchObject({ kind: 'section', heading: 'Morning Worship' })
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Services', 'Songs', 'Assignments'])
  })
})

describe('report renderers', () => {
  it('creates a genuine DOCX bulletin', async () => {
    const report = buildBulletinDocument(
      {
        title: 'Order of Worship',
        dateLine: 'Sunday, August 2, 2026 · Morning Worship',
        lines: [
          { role: 'Call to Worship:', text: 'Psalm 100', person: 'James', separatorBefore: false },
          { text: 'Amazing Grace', kind: 'song', separatorBefore: true },
        ],
      },
      branding,
      '2026-08-02',
    )
    expect(report).toMatchObject({
      orientation: 'landscape',
      showTitle: false,
      showHeaderFooter: false,
    })
    // No page2 content passed (a church with the back page turned off, or an older caller) —
    // a plain single-column document, not a column with nothing in it, and no pinned footer.
    expect(report.blocks[0]).toMatchObject({
      kind: 'columns',
      columns: [{ width: '*' }],
    })
    expect(report.pageFooterColumns).toBeUndefined()
    const bytes = await renderDocx(report)
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('PK')
    const pdfBytes = await renderPdf(report)
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-')
  })

  it('adds a real second column and pinned page footers when page2 content is passed', async () => {
    const report = buildBulletinDocument(
      {
        title: 'Order of Worship',
        dateLine: 'Sunday, August 2, 2026 · Morning Worship',
        lines: [{ text: 'Amazing Grace', kind: 'song', separatorBefore: false }],
        footer: { title: 'Heart Preparation', text: 'Be still.' },
      },
      branding,
      '2026-08-02',
      {
        title: 'Announcements',
        upcoming: [{ dateLabel: 'Aug 9', text: 'Church picnic' }],
        general: [{ text: 'Nursery volunteers needed' }],
        servingSchedule: {
          headers: ['Role', 'This Week', 'Next Week'],
          rows: [{ role: 'Nursery', thisWeek: ['Alex'], nextWeek: ['TBD'] }],
        },
        footer: { title: 'Thought to Ponder', text: 'Grace upon grace.' },
      },
    )
    expect(report.blocks[0]).toMatchObject({
      kind: 'columns',
      columns: [{ width: '*' }, { width: '*' }],
    })
    // Footers are pinned to the page bottom via pageFooterColumns, not appended into the
    // regular content columns above.
    expect(report.pageFooterColumns).toHaveLength(2)
    const bytes = await renderDocx(report)
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('PK')
    const pdfBytes = await renderPdf(report)
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-')
  })

  it('creates a genuine PDF with the shared document renderer', async () => {
    const bytes = await renderPdf(buildSongUsageDocument(songUsageInput))
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('creates a readable XLSX workbook with typed usage data', async () => {
    const bytes = await renderXlsx(buildSongUsageWorkbook(songUsageInput))
    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('PK')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer)
    const usage = workbook.getWorksheet('Usage')!
    expect(usage.getCell('A1').value).toBe('Song Usage Report')
    expect(usage.getCell('D5').value).toBe(3)
  })
})
