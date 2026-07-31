import type { OrderOfWorshipDoc } from '@/utils/orderOfWorship'
import type { DocumentReport, ReportBlock, ReportBranding, ReportRun } from '../types'

export function buildBulletinDocument(
  doc: OrderOfWorshipDoc,
  branding: ReportBranding,
  serviceDate?: string,
): DocumentReport {
  const blocks: ReportBlock[] = []

  for (const line of doc.lines) {
    const runs: ReportRun[] = [
      ...(line.role ? [{ text: `${line.role} `, bold: true }] : []),
      ...(line.text ? [{ text: line.text }] : []),
    ]

    if (line.person) {
      blocks.push({
        kind: 'columns',
        columns: [
          { width: '*', blocks: [{ kind: 'paragraph', runs, style: 'body' }] },
          {
            width: 150,
            blocks: [
              {
                kind: 'paragraph',
                runs: [{ text: line.person, italics: true }],
                alignment: 'right',
                style: 'body',
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
        style: 'body',
        spacingBefore: line.separatorBefore ? 8 : 1,
        spacingAfter: 1,
      })
    }

    if (line.note) {
      blocks.push({
        kind: 'paragraph',
        runs: [{ text: line.note, italics: true }],
        style: 'note',
        spacingAfter: 3,
      })
    }
  }

  return {
    title: doc.title,
    subtitle: doc.dateLine,
    showTitle: false,
    showHeaderFooter: false,
    subject: 'Service bulletin and order of worship',
    filenameBase: `Bulletin - ${serviceDate ?? filenameDate(doc.dateLine)}`,
    branding,
    orientation: 'landscape',
    blocks: [
      {
        kind: 'columns',
        gap: 36,
        columns: [
          {
            width: '*',
            blocks: [
              {
                kind: 'paragraph',
                runs: [{ text: doc.title, bold: true }],
                alignment: 'center',
                style: 'title',
                spacingAfter: 4,
              },
              {
                kind: 'paragraph',
                runs: [{ text: doc.dateLine }],
                alignment: 'center',
                style: 'subtitle',
                spacingAfter: 16,
              },
              ...blocks,
            ],
          },
          {
            width: '*',
            // Reserved for announcements and other bulletin content in a later iteration.
            blocks: [{ kind: 'paragraph', runs: [{ text: '' }], style: 'body' }],
          },
        ],
      },
    ],
  }
}

function filenameDate(dateLine: string): string {
  return dateLine.split(' · ')[0] || 'Service'
}
