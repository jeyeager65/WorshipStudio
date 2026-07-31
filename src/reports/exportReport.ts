import { getAdapter } from '@/adapters'
import type { ExportResult } from '@/adapters/types'
import type { DocumentReport, ReportFormat, WorkbookReport } from './types'

const FORMAT_INFO = {
  docx: {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  pdf: { extension: 'pdf', mimeType: 'application/pdf' },
  xlsx: {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
} as const

export async function exportDocumentReport(
  report: DocumentReport,
  format: 'docx' | 'pdf',
): Promise<ExportResult> {
  const bytes =
    format === 'docx'
      ? await import('./renderers/docx').then(({ renderDocx }) => renderDocx(report))
      : await import('./renderers/pdf').then(({ renderPdf }) => renderPdf(report))
  return saveBytes(report.filenameBase, format, bytes)
}

export async function exportWorkbookReport(report: WorkbookReport): Promise<ExportResult> {
  const bytes = await import('./renderers/xlsx').then(({ renderXlsx }) => renderXlsx(report))
  return saveBytes(report.filenameBase, 'xlsx', bytes)
}

async function saveBytes(
  filenameBase: string,
  format: ReportFormat,
  bytes: Uint8Array,
): Promise<ExportResult> {
  const info = FORMAT_INFO[format]
  return getAdapter().exports.saveFile(
    {
      suggestedName: `${safeFilename(filenameBase)}.${info.extension}`,
      extensions: [info.extension],
      mimeType: info.mimeType,
      bytes,
    },
    { openAfterSave: true },
  )
}

export function exportCompletionMessage(format: ReportFormat, result: ExportResult): string {
  const label = format === 'docx' ? 'Word document' : format === 'xlsx' ? 'Excel workbook' : 'PDF'
  if (getAdapter().kind !== 'tauri') return `${label} downloaded`
  return result === 'opened'
    ? `${label} saved and opened`
    : `${label} saved, but could not be opened automatically`
}

function safeFilename(value: string): string {
  const safe = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return safe || 'Worship Studio Report'
}
