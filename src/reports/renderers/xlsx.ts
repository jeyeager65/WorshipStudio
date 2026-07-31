import ExcelJS from 'exceljs'
import { withoutHash } from '../branding'
import type { WorkbookReport } from '../types'

export async function renderXlsx(report: WorkbookReport): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Worship Studio'
  workbook.company = report.branding.churchName
  workbook.created = new Date()
  workbook.modified = new Date()

  const primary = withoutHash(report.branding.primaryColor)
  const secondary = withoutHash(report.branding.secondaryColor)

  for (const sheetDefinition of report.sheets) {
    const sheet = workbook.addWorksheet(sheetDefinition.name, {
      views: sheetDefinition.freezeHeader
        ? [{ state: 'frozen', ySplit: titleRowCount(sheetDefinition) + 1 }]
        : undefined,
      properties: { defaultRowHeight: 18 },
      pageSetup: {
        orientation: sheetDefinition.columns.length > 5 ? 'landscape' : 'portrait',
        fitToPage: true,
        fitToWidth: 1,
      },
    })

    let nextRow = 1
    if (sheetDefinition.title) {
      sheet.mergeCells(nextRow, 1, nextRow, Math.max(1, sheetDefinition.columns.length))
      const titleCell = sheet.getCell(nextRow, 1)
      titleCell.value = sheetDefinition.title
      titleCell.font = { bold: true, size: 18, color: { argb: `FF${primary}` } }
      titleCell.alignment = { vertical: 'middle' }
      sheet.getRow(nextRow).height = 28
      nextRow += 1
    }
    if (sheetDefinition.subtitle) {
      sheet.mergeCells(nextRow, 1, nextRow, Math.max(1, sheetDefinition.columns.length))
      const subtitleCell = sheet.getCell(nextRow, 1)
      subtitleCell.value = sheetDefinition.subtitle
      subtitleCell.font = { italic: true, size: 10, color: { argb: 'FF666666' } }
      nextRow += 2
    }

    const headerRowNumber = nextRow
    const headerRow = sheet.getRow(headerRowNumber)
    for (const [index, column] of sheetDefinition.columns.entries()) {
      const cell = headerRow.getCell(index + 1)
      cell.value = column.header
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${primary}` } }
      cell.alignment = { vertical: 'middle' }
      sheet.getColumn(index + 1).width = column.width ?? 18
      if (column.numberFormat) sheet.getColumn(index + 1).numFmt = column.numberFormat
    }
    headerRow.height = 23

    for (const [rowIndex, source] of sheetDefinition.rows.entries()) {
      const row = sheet.getRow(headerRowNumber + rowIndex + 1)
      for (const [columnIndex, column] of sheetDefinition.columns.entries()) {
        const cell = row.getCell(columnIndex + 1)
        cell.value = source[column.key]
        cell.alignment = { vertical: 'top', wrapText: true }
        if (rowIndex % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F8' } }
        }
      }
    }

    if (sheetDefinition.autoFilter && sheetDefinition.columns.length) {
      sheet.autoFilter = {
        from: { row: headerRowNumber, column: 1 },
        to: {
          row: headerRowNumber + sheetDefinition.rows.length,
          column: sheetDefinition.columns.length,
        },
      }
    }

    sheet.getColumn(1).border = { left: { style: 'thin', color: { argb: `FF${secondary}` } } }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

function titleRowCount(sheet: WorkbookReport['sheets'][number]): number {
  return (sheet.title ? 1 : 0) + (sheet.subtitle ? 2 : 0)
}
