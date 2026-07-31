export type ReportFormat = 'docx' | 'pdf' | 'xlsx'

export interface ReportBranding {
  churchName: string
  primaryColor: string
  secondaryColor: string
}

export interface ReportRun {
  text: string
  bold?: boolean
  italics?: boolean
  color?: string
}

export interface ReportParagraph {
  kind: 'paragraph'
  runs: ReportRun[]
  alignment?: 'left' | 'center' | 'right'
  style?: 'title' | 'subtitle' | 'heading' | 'body' | 'note'
  spacingBefore?: number
  spacingAfter?: number
}

export interface ReportTableCell {
  runs: ReportRun[]
  alignment?: 'left' | 'center' | 'right'
}

export interface ReportTable {
  kind: 'table'
  headers: string[]
  rows: ReportTableCell[][]
  widths?: Array<number | '*'>
  headerRows?: number
}

export interface ReportList {
  kind: 'list'
  heading?: string
  items: string[]
  ordered?: boolean
  emptyText?: string
}

export interface ReportColumns {
  kind: 'columns'
  columns: Array<{ width?: number | '*'; blocks: ReportBlock[] }>
  gap?: number
}

export interface ReportSection {
  kind: 'section'
  heading: string
  subheading?: string
  accent?: string
  keepTogether?: boolean
  blocks: ReportBlock[]
}

export type ReportBlock = ReportParagraph | ReportTable | ReportList | ReportColumns | ReportSection

export interface DocumentReport {
  title: string
  subtitle?: string
  /** Defaults to true. Disable when a specialized layout places its own title in the body. */
  showTitle?: boolean
  /** Defaults to true. Controls the branded page header and generated-by/page-number footer. */
  showHeaderFooter?: boolean
  filenameBase: string
  subject?: string
  orientation?: 'portrait' | 'landscape'
  branding: ReportBranding
  blocks: ReportBlock[]
}

export type WorkbookCellValue = string | number | boolean | Date | null

export interface WorkbookColumn {
  key: string
  header: string
  width?: number
  numberFormat?: string
}

export interface WorkbookSheet {
  name: string
  title?: string
  subtitle?: string
  columns: WorkbookColumn[]
  rows: Array<Record<string, WorkbookCellValue>>
  freezeHeader?: boolean
  autoFilter?: boolean
}

export interface WorkbookReport {
  filenameBase: string
  branding: ReportBranding
  sheets: WorkbookSheet[]
}

export interface ExportOption {
  format: ReportFormat
  label: string
  description: string
  icon: string
}

export const WORD_EXPORT: ExportOption = {
  format: 'docx',
  label: 'Edit in Word',
  description: 'Editable Word document',
  icon: 'mdi-file-word-outline',
}

export const PDF_EXPORT: ExportOption = {
  format: 'pdf',
  label: 'Share as PDF',
  description: 'Fixed layout for printing or sharing',
  icon: 'mdi-file-pdf-box',
}

export const EXCEL_EXPORT: ExportOption = {
  format: 'xlsx',
  label: 'Open in Excel',
  description: 'Sortable Excel workbook',
  icon: 'mdi-file-excel-outline',
}
