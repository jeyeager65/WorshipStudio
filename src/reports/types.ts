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
  underline?: boolean
  color?: string
  /** Points. Falls back to the containing block's own style-based default when unset. */
  fontSize?: number
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
  /** The cell's first (or only) line. */
  runs: ReportRun[]
  /** Further lines below the first, each its own paragraph within the cell — for content that's
   *  naturally a short list (e.g. one name per line) rather than one flowing, comma-joined line. */
  extraLines?: ReportRun[][]
  alignment?: 'left' | 'center' | 'right'
}

export interface ReportTable {
  kind: 'table'
  headers: string[]
  rows: ReportTableCell[][]
  widths?: Array<number | '*'>
  headerRows?: number
  /** Bold black-on-white header instead of the usual colored fill bar — for content meant to
   *  print cleanly on a monochrome printer (e.g. the bulletin's serving schedule). */
  plainHeader?: boolean
  /** Points. Falls back to the renderer's own default header size when unset. */
  headerFontSize?: number
}

export interface ReportList {
  kind: 'list'
  heading?: string
  /** Points/color for `heading` specifically — falls back to the renderer's own defaults
   *  (branding-primary-colored, a fixed size) when unset. */
  headingFontSize?: number
  headingColor?: string
  /** A plain string renders as a single run at the list's default style — pass an array of runs
   *  instead for a line that mixes styling (e.g. a bold date lead-in followed by plain text). */
  items: (string | ReportRun[])[]
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
  /** Rendered pinned to the bottom of every page via each renderer's own native page-footer
   *  mechanism (Word's section Footer / pdfmake's footer callback) — unlike `blocks`, this stays
   *  at the bottom regardless of how much content precedes it. Laid out as columns matching
   *  `blocks`' own top-level column widths, so each footer lines up under its own column. */
  pageFooterColumns?: { width?: number | '*'; blocks: ReportBlock[] }[]
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
