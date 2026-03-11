import { Readable } from 'stream'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { parse as parseCsv } from 'csv-parse/sync'

export type ParsedDocument = {
  text: string
  sourceType: string
  sourceLocator?: string
  segments?: Array<{
    text: string
    sourceLocator?: string
  }>
}

type SheetRow = {
  rowNumber: number
  cells: Array<unknown>
}

function escapeMarkdownCell(value: unknown) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function isBlankCell(value: unknown) {
  return escapeMarkdownCell(value) === ''
}

function isBlankRow(row: Array<unknown>) {
  return row.length === 0 || row.every((cell) => isBlankCell(cell))
}

function countNonBlankCells(row: Array<unknown>) {
  return row.reduce<number>((count, cell) => count + (isBlankCell(cell) ? 0 : 1), 0)
}

function normalizeBoilerplateKey(text: string) {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeExactBoilerplateKey(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function toSparseRowText(row: Array<unknown>) {
  return row.map((cell) => escapeMarkdownCell(cell)).filter(Boolean).join(' | ')
}

function rowsToMarkdownTable(rows: Array<Array<unknown>>) {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((row) => row.length), 1)
  const headerRow = (rows[0] || []).map((v, idx) => escapeMarkdownCell(v) || `col_${idx + 1}`)
  while (headerRow.length < width) headerRow.push(`col_${headerRow.length + 1}`)

  const divider = new Array(width).fill('---')
  const bodyRows = rows.slice(1).map((row) => {
    const cells = row.map((v) => escapeMarkdownCell(v))
    while (cells.length < width) cells.push('')
    return cells
  })

  const lines = [
    `| ${headerRow.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...bodyRows.map((row) => `| ${row.join(' | ')} |`)
  ]

  return lines.join('\n')
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitDocxBlocks(text: string) {
  return normalizeExtractedText(text)
    .split(/\n{2,}/g)
    .map((block) => block.trim())
    .filter(Boolean)
}

function isMarkdownTableBlock(block: string) {
  return block.includes('\n| ') || /^\| .+ \|$/m.test(block)
}

function isShortBoilerplateBlock(block: string) {
  const compact = block.replace(/\s+/g, ' ').trim()
  if (!compact || compact.length > 80) return false
  if (/^#{1,6}\s+/.test(compact)) return false
  if (isMarkdownTableBlock(compact)) return false
  return compact.split(' ').length <= 8
}

function removeRepeatedDocxBoilerplateBlocks(text: string) {
  const blocks = splitDocxBlocks(text)
  if (blocks.length < 4) return normalizeExtractedText(text)

  const counts = new Map<string, number>()
  for (const block of blocks) {
    if (!isShortBoilerplateBlock(block)) continue
    const key = normalizeBoilerplateKey(block)
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const repeated = new Set(Array.from(counts.entries())
    .filter(([, count]) => count >= 3)
    .map(([key]) => key))

  if (repeated.size === 0) return normalizeExtractedText(text)

  return normalizeExtractedText(blocks
    .filter((block) => !repeated.has(normalizeBoilerplateKey(block)))
    .join('\n\n'))
}

function toDocxSectionLocator(title: string, index: number) {
  const cleaned = title.replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim()
  return cleaned ? `section:${cleaned}` : `section:${index}`
}

function buildDocxSegments(text: string) {
  const blocks = splitDocxBlocks(text)
  if (blocks.length === 0) return [] as Array<{ text: string; sourceLocator?: string }>

  const segments: Array<{ text: string; sourceLocator?: string }> = []
  let currentBlocks: string[] = []
  let currentTitle = ''

  const flush = () => {
    if (currentBlocks.length === 0) return
    segments.push({
      text: normalizeExtractedText(currentBlocks.join('\n\n')),
      sourceLocator: toDocxSectionLocator(currentTitle, segments.length + 1)
    })
    currentBlocks = []
    currentTitle = ''
  }

  for (const block of blocks) {
    const isHeading = /^#{1,6}\s+/.test(block)
    if (isHeading) {
      flush()
      currentTitle = block
      currentBlocks = [block]
      continue
    }

    if (currentBlocks.length === 0) {
      currentBlocks = [block]
      continue
    }

    const nextText = `${currentBlocks.join('\n\n')}\n\n${block}`
    if (nextText.length > 1400 && currentBlocks.length > 0) {
      flush()
    }

    if (currentBlocks.length === 0) {
      currentBlocks = [block]
    } else {
      currentBlocks.push(block)
    }
  }

  flush()
  return segments
}

function toSheetRows(rows: Array<Array<unknown>>) {
  return rows.map((cells, index) => ({
    rowNumber: index + 1,
    cells: cells || []
  }))
}

function removeRepeatedWorkbookEdgeRows(sheetRowsList: SheetRow[][]) {
  if (sheetRowsList.length < 2) return sheetRowsList

  const edgeDepth = 4
  const threshold = Math.max(2, Math.ceil(sheetRowsList.length * 0.6))
  const topCounts = new Map<string, number>()
  const bottomCounts = new Map<string, number>()

  for (const rows of sheetRowsList) {
    const topRows = rows.filter((row) => !isBlankRow(row.cells)).slice(0, edgeDepth)
    const bottomRows = rows.filter((row) => !isBlankRow(row.cells)).slice(-edgeDepth)
    const topKeys = new Set<string>(topRows
      .filter((row) => countNonBlankCells(row.cells) <= 2)
      .map((row) => normalizeExactBoilerplateKey(toSparseRowText(row.cells)))
      .filter((key) => key.length > 0 && key.length <= 120))
    const bottomKeys = new Set<string>(bottomRows
      .filter((row) => countNonBlankCells(row.cells) <= 2)
      .map((row) => normalizeExactBoilerplateKey(toSparseRowText(row.cells)))
      .filter((key) => key.length > 0 && key.length <= 120))

    for (const key of topKeys) topCounts.set(key, (topCounts.get(key) || 0) + 1)
    for (const key of bottomKeys) bottomCounts.set(key, (bottomCounts.get(key) || 0) + 1)
  }

  const repeatedTop = new Set(Array.from(topCounts.entries()).filter(([, count]) => count >= threshold).map(([key]) => key))
  const repeatedBottom = new Set(Array.from(bottomCounts.entries()).filter(([, count]) => count >= threshold).map(([key]) => key))

  return sheetRowsList.map((rows) => {
    const nonBlankRows = rows.filter((row) => !isBlankRow(row.cells))
    const topWindow = new Set(nonBlankRows.slice(0, edgeDepth).map((row) => row.rowNumber))
    const bottomWindow = new Set(nonBlankRows.slice(-edgeDepth).map((row) => row.rowNumber))
    return rows.filter((row) => {
      if (isBlankRow(row.cells)) return true
      const key = normalizeExactBoilerplateKey(toSparseRowText(row.cells))
      if (topWindow.has(row.rowNumber) && repeatedTop.has(key)) return false
      if (bottomWindow.has(row.rowNumber) && repeatedBottom.has(key)) return false
      return true
    })
  })
}

function toSheetRowBlocks(rows: SheetRow[]) {
  const blocks: Array<{ startRow: number; endRow: number; rows: Array<Array<unknown>> }> = []
  let current: Array<Array<unknown>> = []
  let startRow = 0
  let endRow = 0

  for (const row of rows) {
    if (isBlankRow(row.cells)) {
      if (current.length > 0) {
        blocks.push({
          startRow,
          endRow,
          rows: current
        })
        current = []
      }
      continue
    }

    if (current.length === 0) {
      startRow = row.rowNumber
    }
    current.push(row.cells)
    endRow = row.rowNumber
  }

  if (current.length > 0) {
    blocks.push({
      startRow,
      endRow,
      rows: current
    })
  }

  return blocks
}

function buildSheetBlockText(sheetName: string, block: { rows: Array<Array<unknown>> }) {
  const tableText = rowsToMarkdownTable(block.rows) || '(empty sheet)'
  const rowExpansion = rowsToExpandedKeyValueText(block.rows)
  return normalizeExtractedText([
    `## Sheet: ${sheetName}`,
    '',
    tableText,
    rowExpansion ? `\n### Row Summary\n\n${rowExpansion}` : ''
  ].join('\n'))
}

function toSheetLocator(sheetName: string, startRow: number, endRow: number) {
  return `sheet:${sheetName} row:${startRow}-${endRow}`
}

function inferHeaderRow(rows: Array<Array<unknown>>) {
  if (rows.length === 0) return [] as string[]
  const firstRow = rows[0] || []
  const normalized = firstRow.map((cell, index) => escapeMarkdownCell(cell) || `col_${index + 1}`)
  const uniqueValues = new Set(normalized.filter(Boolean))
  const nonBlankCount = normalized.filter(Boolean).length
  const looksLikeHeader = nonBlankCount >= 2 && uniqueValues.size >= Math.max(2, Math.floor(nonBlankCount * 0.6))
  if (looksLikeHeader) return normalized
  return normalized.map((_, index) => `col_${index + 1}`)
}

function rowsToExpandedKeyValueText(rows: Array<Array<unknown>>) {
  if (rows.length <= 1) return ''
  const headerRow = inferHeaderRow(rows)
  const bodyRows = rows.slice(1)
  const lines: string[] = []

  bodyRows.forEach((row, rowIndex) => {
    const entries: string[] = []
    for (let index = 0; index < Math.max(headerRow.length, row.length); index += 1) {
      const key = escapeMarkdownCell(headerRow[index] || `col_${index + 1}`)
      const value = escapeMarkdownCell(row[index] || '')
      if (!key || !value) continue
      entries.push(`${key}=${value}`)
    }
    if (entries.length > 0) {
      lines.push(`row_${rowIndex + 2}: ${entries.join('; ')}`)
    }
  })

  return lines.join('\n')
}

function splitPdfPages(rawText: string) {
  const normalized = rawText.replace(/\r\n/g, '\n')
  const pages = normalized.split(/\f+/g).map((page) => page.trim()).filter(Boolean)
  return pages.length > 0 ? pages : [normalized.trim()].filter(Boolean)
}

function looksLikePageNumberLine(line: string) {
  const value = line.trim().toLowerCase()
  if (!value) return false
  if (/^page\s+\d+(\s*\/\s*\d+)?$/.test(value)) return true
  if (/^page\s+\d+\s+of\s+\d+$/.test(value)) return true
  if(/^\d+\s*\/\s*\d+$/.test(value)) return true
  if (/^-?\s*\d+\s*-?$/.test(value)) return true
  return false
}

function removeRepeatedPdfHeaderFooter(pages: string[]) {
  if (pages.length < 2) return pages

  const threshold = Math.max(2, Math.ceil(pages.length * 0.6))
  const topCounts = new Map<string, number>()
  const bottomCounts = new Map<string, number>()

  const pageLines = pages.map((page) => page.split('\n').map((line) => line.trim()).filter(Boolean))

  for (const lines of pageLines) {
    const topUnique = new Set(lines.slice(0, 3))
    const bottomUnique = new Set(lines.slice(-3))

    for (const line of topUnique) {
      const key = normalizeBoilerplateKey(line)
      topCounts.set(key, (topCounts.get(key) || 0) + 1)
    }
    for (const line of bottomUnique) {
      const key = normalizeBoilerplateKey(line)
      bottomCounts.set(key, (bottomCounts.get(key) || 0) + 1)
    }
  }

  const repeatedTop = new Set(Array.from(topCounts.entries())
    .filter(([line, count]) => count >= threshold && line.length <= 120)
    .map(([line]) => line))
  const repeatedBottom = new Set(Array.from(bottomCounts.entries())
    .filter(([line, count]) => count >= threshold && line.length <= 120)
    .map(([line]) => line))

  return pageLines.map((lines) => {
    const startWindow = new Set(lines.slice(0, 3))
    const endWindow = new Set(lines.slice(-3))
    return lines
      .filter((line) => !looksLikePageNumberLine(line))
      .filter((line) => !(startWindow.has(line) && repeatedTop.has(normalizeBoilerplateKey(line))))
      .filter((line) => !(endWindow.has(line) && repeatedBottom.has(normalizeBoilerplateKey(line))))
      .join('\n')
      .trim()
  }).filter(Boolean)
}

function formatPdfAsMarkdown(pages: string[]) {
  return pages
    .map((pageText, index) => `## Page ${index + 1}\n\n${pageText}`)
    .join('\n\n')
}

export const __notebookParsingTestables = {
  splitPdfPages,
  removeRepeatedPdfHeaderFooter,
  looksLikePageNumberLine,
  removeRepeatedWorkbookEdgeRows,
  toSheetRows,
  removeRepeatedDocxBoilerplateBlocks,
  buildDocxSegments,
  rowsToExpandedKeyValueText
}

function normalizeMime(mime: string | null | undefined, fileName: string | null | undefined) {
  const m = String(mime || '').toLowerCase()
  const name = String(fileName || '').toLowerCase()
  if (m.includes('pdf') || name.endsWith('.pdf')) return 'pdf'
  if (m.includes('word') || name.endsWith('.docx')) return 'docx'
  if (m.includes('csv') || name.endsWith('.csv')) return 'csv'
  if (m.includes('sheet') || name.endsWith('.xlsx')) return 'xlsx'
  if (m.includes('markdown') || name.endsWith('.md')) return 'md'
  if (m.includes('text/plain') || name.endsWith('.txt')) return 'txt'
  return 'unsupported'
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function readResponseBodySafe(resp: Response) {
  try {
    return await resp.text()
  } catch {
    return ''
  }
}

async function fetchDownload(matrixBaseUrl: string, path: string, accessToken?: string, asQueryToken = false) {
  const url = new URL(path, matrixBaseUrl)
  const headers: Record<string, string> = {}
  if (accessToken && !asQueryToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (accessToken && asQueryToken) {
    url.searchParams.set('access_token', accessToken)
  }
  return fetch(url, { headers })
}

export async function fetchMatrixMediaBuffer(matrixBaseUrl: string, accessToken: string | undefined, mxc: string): Promise<Buffer> {
  const normalized = mxc.replace('mxc://', '')
  const [serverName, mediaId] = normalized.split('/')
  if (!serverName || !mediaId) {
    throw new Error('INVALID_MXC')
  }

  const encodedServer = encodeURIComponent(serverName)
  const encodedMedia = encodeURIComponent(mediaId)
  const candidatePaths = [
    `/_matrix/media/v3/download/${encodedServer}/${encodedMedia}`,
    `/_matrix/client/v1/media/download/${encodedServer}/${encodedMedia}`,
    `/_matrix/media/r0/download/${encodedServer}/${encodedMedia}`
  ]

  let lastStatus = 0
  let lastBody = ''

  const attempts: Array<{ token?: string; asQuery?: boolean }> = []
  if (accessToken) {
    attempts.push({ token: accessToken, asQuery: false })
    attempts.push({ token: accessToken, asQuery: true })
  }
  attempts.push({ token: undefined, asQuery: false })

  for (const attempt of attempts) {
    for (const path of candidatePaths) {
      const resp = await fetchDownload(matrixBaseUrl, path, attempt.token, Boolean(attempt.asQuery))
      if (resp.ok && resp.body) {
        return streamToBuffer(Readable.fromWeb(resp.body as any))
      }
      lastStatus = resp.status
      lastBody = await readResponseBodySafe(resp)
    }
  }

  const hint = accessToken
    ? ' (check NOTEBOOK_INDEX_MATRIX_ACCESS_TOKEN and NOTEBOOK_INDEX_MATRIX_HS_URL)'
    : ' (missing NOTEBOOK_INDEX_MATRIX_ACCESS_TOKEN)'
  throw new Error(`MEDIA_DOWNLOAD_FAILED: ${lastStatus} ${lastBody}${hint}`)
}

export async function parseDocument(buffer: Buffer, matrixMediaMime?: string | null, matrixMediaName?: string | null): Promise<ParsedDocument> {
  const type = normalizeMime(matrixMediaMime, matrixMediaName)

  if (type === 'txt' || type === 'md') {
    return { text: normalizeExtractedText(buffer.toString('utf8')), sourceType: type }
  }

  if (type === 'pdf') {
    const parser = new PDFParse({ data: buffer })
    const data = await parser.getText()
    await parser.destroy()
    const pages = splitPdfPages(String(data.text || ''))
    const cleanedPages = removeRepeatedPdfHeaderFooter(pages)
    const text = normalizeExtractedText(formatPdfAsMarkdown(cleanedPages.length > 0 ? cleanedPages : pages))
    return {
      text,
      sourceType: 'pdf',
      sourceLocator: `page:1-${Math.max(cleanedPages.length, pages.length, 1)}`
    }
  }

  if (type === 'docx') {
    let markdownValue = ''
    const convertToMarkdown = (mammoth as any).convertToMarkdown
    if (typeof convertToMarkdown === 'function') {
      const markdown = await convertToMarkdown({ buffer }).catch(() => ({ value: '' }))
      markdownValue = String(markdown?.value || '')
    }

    if (markdownValue.trim()) {
      const cleanedText = removeRepeatedDocxBoilerplateBlocks(markdownValue)
      const segments = buildDocxSegments(cleanedText)
      return {
        text: cleanedText,
        sourceType: 'docx',
        sourceLocator: segments[0]?.sourceLocator,
        segments
      }
    }

    const data = await mammoth.extractRawText({ buffer })
    const cleanedText = removeRepeatedDocxBoilerplateBlocks(String(data.value || ''))
    const segments = buildDocxSegments(cleanedText)
    return {
      text: cleanedText,
      sourceType: 'docx',
      sourceLocator: segments[0]?.sourceLocator,
      segments
    }
  }

  if (type === 'csv') {
    const rows = parseCsv(buffer.toString('utf8'), { skip_empty_lines: true }) as string[][]
    const table = rowsToMarkdownTable(rows)
    const text = normalizeExtractedText([
      '# CSV Document',
      '',
      table || '(empty csv)'
    ].join('\n'))
    return { text, sourceType: 'csv', sourceLocator: 'row:1-' + Math.max(rows.length, 1) }
  }

  if (type === 'xlsx') {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const lines: string[] = []
    const segments: Array<{ text: string; sourceLocator?: string }> = []
    let firstLocator = ''

    const workbookSheets = workbook.SheetNames.map((sheetName) => {
      const ws = workbook.Sheets[sheetName]
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as Array<Array<string | number | boolean | null>>
      return {
        sheetName,
        rawRows: json,
        sheetRows: toSheetRows(json)
      }
    })

    const cleanedSheetRowsList = removeRepeatedWorkbookEdgeRows(workbookSheets.map((sheet) => sheet.sheetRows))

    workbookSheets.forEach((sheet, sheetIndex) => {
      const sheetBlocks = toSheetRowBlocks(cleanedSheetRowsList[sheetIndex] || sheet.sheetRows)
      const locator = toSheetLocator(sheet.sheetName, 1, Math.max(sheet.rawRows.length, 1))

      if (sheetBlocks.length === 0) {
        const emptyText = normalizeExtractedText([
          `## Sheet: ${sheet.sheetName}`,
          '',
          '(empty sheet)'
        ].join('\n'))
        lines.push(emptyText)
        lines.push('')
        segments.push({ text: emptyText, sourceLocator: locator })
      } else {
        sheetBlocks.forEach((block) => {
          const blockText = buildSheetBlockText(sheet.sheetName, block)
          const blockLocator = toSheetLocator(sheet.sheetName, block.startRow, block.endRow)
          lines.push(blockText)
          lines.push('')
          segments.push({ text: blockText, sourceLocator: blockLocator })
        })
      }

      if (!firstLocator && sheet.rawRows.length > 0) {
        firstLocator = locator
      }
    })

    return {
      text: normalizeExtractedText(lines.join('\n')),
      sourceType: 'xlsx',
      sourceLocator: firstLocator || undefined,
      segments
    }
  }

  throw new Error('UNSUPPORTED_FILE_TYPE')
}
