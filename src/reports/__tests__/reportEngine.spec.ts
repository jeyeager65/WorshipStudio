import { describe, expect, it } from 'vitest'
import { buildSongUsageDocument, buildSongUsageWorkbook } from '@/reports/builders/songUsage'
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
      {
        songId: 's1',
        title: 'Amazing Grace',
        ccli: '22025',
        author: 'John Newton',
        timesUsed: 3,
        dates: ['2026-01-04', '2026-03-01', '2026-05-17'],
      },
      {
        songId: 's2',
        title: 'Doxology',
        author: 'Thomas Ken',
        timesUsed: 1,
        dates: ['2026-02-08'],
      },
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
      mainPassage: 'Romans 8:28-39',
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

  it('formats Dates Used as MM/DD, omitting the year, when the whole report range is one calendar year', () => {
    // songUsageInput's own range (2026-01-01 to 2026-07-31) is entirely within 2026.
    const document = buildSongUsageDocument(songUsageInput)
    const usageTable = document.blocks[2]
    if (usageTable.kind !== 'table') throw new Error('expected a table block')
    const datesCell = usageTable.rows[0]?.[4]
    expect(datesCell?.runs[0]?.text).toBe('01/04, 03/01, 05/17')

    const workbook = buildSongUsageWorkbook(songUsageInput)
    expect(workbook.sheets[0].rows[0]?.dates).toBe('01/04\n03/01\n05/17')
  })

  it('formats Dates Used as MM/DD/YYYY when the report range spans more than one calendar year', () => {
    const multiYearInput = { ...songUsageInput, fromDate: '2025-11-01', toDate: '2026-07-31' }
    const document = buildSongUsageDocument(multiYearInput)
    const usageTable = document.blocks[2]
    if (usageTable.kind !== 'table') throw new Error('expected a table block')
    const datesCell = usageTable.rows[0]?.[4]
    expect(datesCell?.runs[0]?.text).toBe('01/04/2026, 03/01/2026, 05/17/2026')

    const workbook = buildSongUsageWorkbook(multiYearInput)
    expect(workbook.sheets[0].rows[0]?.dates).toBe('01/04/2026\n03/01/2026\n05/17/2026')
  })

  it('omits the CCLI # column entirely when nothing in the result set has a CCLI number', () => {
    const noCcliInput = {
      ...songUsageInput,
      summary: {
        ...songUsageInput.summary,
        rows: songUsageInput.summary.rows.map((row) => ({ ...row, ccli: undefined })),
      },
    }
    const document = buildSongUsageDocument(noCcliInput)
    const usageTable = document.blocks[2]
    if (usageTable.kind !== 'table') throw new Error('expected a table block')
    expect(usageTable.headers).not.toContain('CCLI #')
    expect(usageTable.headers).toEqual(['Song', 'Author', 'Uses', 'Dates Used'])

    const workbook = buildSongUsageWorkbook(noCcliInput)
    const headers = workbook.sheets[0].columns.map((column) => column.header)
    expect(headers).not.toContain('CCLI Number')
    // Every row's own keys must drop 'ccli' too, not just the column list — otherwise a stray
    // exported value would sit under a header that no longer exists.
    expect(workbook.sheets[0].rows[0]).not.toHaveProperty('ccli')
  })

  it('creates document and workbook forms of the multi-week plan', () => {
    const document = buildPlanningDocument(planningInput)
    const workbook = buildPlanningWorkbook(planningInput)

    expect(document.blocks[0]).toMatchObject({ kind: 'section', heading: 'Morning Worship' })
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Services', 'Songs', 'Assignments'])
  })

  it('includes the sermon’s main passage on the sermon line, same title · passage · preacher order as ServiceCard.vue', () => {
    const document = buildPlanningDocument(planningInput)
    const section = document.blocks[0]
    if (section.kind !== 'section') throw new Error('expected a section block')
    const sermonParagraph = section.blocks[0]
    if (sermonParagraph.kind !== 'paragraph') throw new Error('expected a paragraph block')
    const text = sermonParagraph.runs.map((run) => run.text).join('')
    expect(text).toBe('Hope in Christ · Romans 8:28-39 · Pastor Dan')

    const workbook = buildPlanningWorkbook(planningInput)
    const servicesSheet = workbook.sheets.find((sheet) => sheet.name === 'Services')!
    expect(servicesSheet.columns.map((column) => column.header)).toContain('Passage')
    expect(servicesSheet.rows[0]).toMatchObject({ passage: 'Romans 8:28-39' })
  })

  it('drops the roster column’s generic heading, keeping only each group’s own real category name', () => {
    const document = buildPlanningDocument(planningInput)
    const section = document.blocks[0]
    if (section.kind !== 'section') throw new Error('expected a section block')
    const rosterColumn = section.blocks[1]
    if (rosterColumn.kind !== 'columns') throw new Error('expected a columns block')
    const rosterBlocks = rosterColumn.columns[0]!.blocks
    // No leading generic "Team & Building" paragraph heading — the first block is already the
    // first real roster group's own list, headed by its own category name.
    expect(rosterBlocks.every((block) => block.kind !== 'paragraph')).toBe(true)
    expect(rosterBlocks.map((block) => (block.kind === 'list' ? block.heading : undefined))).toEqual([
      'Praise Team',
      'Building',
    ])
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

  // The multi-week plan is the one document report actually using ReportSection blocks (a
  // divider line between services, not a colored bar beside them — see pdf.ts/docx.ts's own
  // renderSection) — neither renderer has any other coverage exercising that block kind at all.
  it('renders a genuine PDF and DOCX for the multi-week plan (ReportSection blocks)', async () => {
    const document = buildPlanningDocument(planningInput)
    const pdfBytes = await renderPdf(document)
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe('%PDF-')
    const docxBytes = await renderDocx(document)
    expect(String.fromCharCode(...docxBytes.slice(0, 2))).toBe('PK')
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
