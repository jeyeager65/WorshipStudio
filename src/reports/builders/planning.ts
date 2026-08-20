import type { PlanningReportRow, PlanningRosterGroup } from '@/utils/planningReport'
import type { DocumentReport, ReportBranding, ReportBlock, WorkbookReport } from '../types'

export interface PlanningReportInput {
  rows: PlanningReportRow[]
  fromDate: string
  toDate: string
  serviceType: string
  branding: ReportBranding
}

export function buildPlanningDocument(input: PlanningReportInput): DocumentReport {
  return {
    title: 'Multi-Week Planning Report',
    subtitle: subtitle(input),
    subject: 'Upcoming service songs and assignments',
    filenameBase: `Multi-Week Plan - ${input.fromDate} to ${input.toDate}`,
    branding: input.branding,
    blocks: input.rows.map((row): ReportBlock => ({
      kind: 'section',
      heading: row.type,
      subheading: row.dateLine,
      accent: input.branding.secondaryColor,
      keepTogether: true,
      blocks: [
        {
          kind: 'paragraph',
          runs: row.sermonTitle
            ? [
                { text: row.sermonTitle, bold: true },
                ...(row.mainPassage ? [{ text: ` · ${row.mainPassage}` }] : []),
                ...(row.preacher ? [{ text: ` · ${row.preacher}` }] : []),
              ]
            : [{ text: 'Sermon details not yet decided', italics: true }],
          style: row.sermonTitle ? 'body' : 'note',
          spacingAfter: 8,
        },
        {
          kind: 'columns',
          gap: 24,
          columns: [
            {
              width: '*',
              blocks: assignmentBlocks(row.rosterGroups),
            },
            {
              width: '*',
              blocks: [reportList('Planned Songs', row.songTitles, 'No songs planned yet', true)],
            },
          ],
        },
      ],
    })),
  }
}

export function buildPlanningWorkbook(input: PlanningReportInput): WorkbookReport {
  return {
    filenameBase: `Multi-Week Plan - ${input.fromDate} to ${input.toDate}`,
    branding: input.branding,
    sheets: [
      {
        name: 'Services',
        title: 'Multi-Week Planning Report',
        subtitle: subtitle(input),
        freezeHeader: true,
        autoFilter: true,
        columns: [
          { key: 'date', header: 'Date', width: 14, numberFormat: 'mmm d, yyyy' },
          { key: 'type', header: 'Service Type', width: 24 },
          { key: 'sermon', header: 'Sermon', width: 32 },
          { key: 'passage', header: 'Passage', width: 20 },
          { key: 'preacher', header: 'Preacher', width: 24 },
          { key: 'songs', header: 'Planned Songs', width: 46 },
          { key: 'assignments', header: 'Assignments', width: 48 },
        ],
        rows: input.rows.map((row) => ({
          date: new Date(`${row.date}T00:00:00`),
          type: row.type,
          sermon: row.sermonTitle ?? '',
          passage: row.mainPassage ?? '',
          preacher: row.preacher ?? '',
          songs: row.songTitles.join('\n'),
          assignments: formatRosterGroups(row.rosterGroups),
        })),
      },
      {
        name: 'Songs',
        freezeHeader: true,
        autoFilter: true,
        columns: [
          { key: 'date', header: 'Date', width: 14, numberFormat: 'mmm d, yyyy' },
          { key: 'type', header: 'Service Type', width: 24 },
          { key: 'position', header: 'Order', width: 10, numberFormat: '0' },
          { key: 'song', header: 'Song', width: 38 },
        ],
        rows: input.rows.flatMap((row) =>
          row.songTitles.map((song, index) => ({
            date: new Date(`${row.date}T00:00:00`),
            type: row.type,
            position: index + 1,
            song,
          })),
        ),
      },
      {
        name: 'Assignments',
        freezeHeader: true,
        autoFilter: true,
        columns: [
          { key: 'date', header: 'Date', width: 14, numberFormat: 'mmm d, yyyy' },
          { key: 'type', header: 'Service Type', width: 24 },
          { key: 'category', header: 'Role Category', width: 24 },
          { key: 'role', header: 'Role', width: 24 },
          { key: 'person', header: 'Person', width: 28 },
          { key: 'tentative', header: 'Tentative', width: 12 },
        ],
        rows: input.rows.flatMap((row) =>
          row.rosterGroups.flatMap((group) =>
            group.assignments.map((assignment) => ({
              date: new Date(`${row.date}T00:00:00`),
              type: row.type,
              category: group.category ?? '',
              role: assignment.role,
              person: assignment.person,
              tentative: assignment.tentative,
            })),
          ),
        ),
      },
    ],
  }
}

// No longer prints its own generic "Team & Building" heading above the group list — each
// group's own reportList heading below is that group's real role category name (e.g. "Praise
// Team", "Building"), so a hardcoded label on top of it was pure redundancy, not a real section
// title (a church's actual categories aren't literally always named "Team & Building" — that was
// just this codebase's own sample data coincidentally matching it).
function assignmentBlocks(groups: PlanningRosterGroup[]): ReportBlock[] {
  if (groups.length === 0) return [reportList('Assignments', [], 'No assignments yet')]
  return groups.map((group): ReportBlock =>
    reportList(group.category ?? '', group.assignments.map(assignmentLabel), ''),
  )
}

function formatRosterGroups(groups: PlanningRosterGroup[]): string {
  return groups
    .flatMap((group) => [
      ...(group.category ? [group.category] : []),
      ...group.assignments.map((assignment) =>
        group.category ? `  ${assignmentLabel(assignment)}` : assignmentLabel(assignment),
      ),
    ])
    .join('\n')
}

function assignmentLabel(assignment: PlanningRosterGroup['assignments'][number]): string {
  return `${assignment.role} — ${assignment.person}${assignment.tentative ? '?' : ''}`
}

function reportList(
  heading: string,
  items: string[],
  emptyText: string,
  ordered = false,
): ReportBlock {
  return { kind: 'list', heading, items, emptyText, ordered }
}

function subtitle(input: PlanningReportInput): string {
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
