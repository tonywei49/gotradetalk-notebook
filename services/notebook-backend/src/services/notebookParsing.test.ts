import test from 'node:test'
import assert from 'node:assert/strict'
import { __notebookParsingTestables } from './notebookParsing.js'

test('pdf cleanup removes repeated headers/footers and page number lines', () => {
  const pages = [
    'Company Handbook\nPage 1 of 3\nPolicy A\nConfidential',
    'Company Handbook\nPage 2 of 3\nPolicy B\nConfidential',
    'Company Handbook\nPage 3 of 3\nPolicy C\nConfidential'
  ]

  const cleaned = __notebookParsingTestables.removeRepeatedPdfHeaderFooter(pages)
  assert.equal(cleaned.length, 3)
  assert.ok(cleaned[0]?.includes('Policy A'))
  assert.ok(cleaned[1]?.includes('Policy B'))
  assert.ok(cleaned[2]?.includes('Policy C'))

  for (const page of cleaned) {
    assert.equal(page.includes('Company Handbook'), false)
    assert.equal(page.toLowerCase().includes('page 1 of 3'), false)
    assert.equal(page.toLowerCase().includes('page 2 of 3'), false)
    assert.equal(page.toLowerCase().includes('page 3 of 3'), false)
    assert.equal(page.includes('Confidential'), false)
  }
})

test('page number detector matches common patterns', () => {
  assert.equal(__notebookParsingTestables.looksLikePageNumberLine('Page 2 of 9'), true)
  assert.equal(__notebookParsingTestables.looksLikePageNumberLine('page 2/9'), true)
  assert.equal(__notebookParsingTestables.looksLikePageNumberLine('2/9'), true)
  assert.equal(__notebookParsingTestables.looksLikePageNumberLine('3'), true)
  assert.equal(__notebookParsingTestables.looksLikePageNumberLine('Section 3 Overview'), false)
})

test('pdf cleanup removes normalized repeated edge lines', () => {
  const pages = [
    '报价单 2025/01\nPage 1 of 3\nBody A\nPrinted 2025-01-01',
    '报价单 2025/02\nPage 2 of 3\nBody B\nPrinted 2025-01-02',
    '报价单 2025/03\nPage 3 of 3\nBody C\nPrinted 2025-01-03'
  ]

  const cleaned = __notebookParsingTestables.removeRepeatedPdfHeaderFooter(pages)
  assert.equal(cleaned.length, 3)
  assert.ok(cleaned[0]?.includes('Body A'))
  assert.ok(cleaned[1]?.includes('Body B'))
  assert.ok(cleaned[2]?.includes('Body C'))

  for (const page of cleaned) {
    assert.equal(page.includes('报价单'), false)
    assert.equal(page.includes('Printed'), false)
  }
})

test('xlsx edge cleanup removes repeated sparse top and bottom rows across sheets', () => {
  const sheetRowsList = [
    __notebookParsingTestables.toSheetRows([
      ['生产指令单'],
      ['订单号', 'A001'],
      ['sku', 'P01'],
      ['备注：内部使用']
    ]),
    __notebookParsingTestables.toSheetRows([
      ['生产指令单'],
      ['订单号', 'A002'],
      ['sku', 'P02'],
      ['备注：内部使用']
    ])
  ]

  const cleaned = __notebookParsingTestables.removeRepeatedWorkbookEdgeRows(sheetRowsList)
  assert.deepEqual(cleaned[0]?.map((row) => row.rowNumber), [2, 3])
  assert.deepEqual(cleaned[1]?.map((row) => row.rowNumber), [2, 3])
})

test('docx cleanup removes repeated short boilerplate blocks', () => {
  const text = [
    'Company Handbook',
    '',
    '# Policy A',
    '',
    'Body A',
    '',
    'Confidential',
    '',
    'Company Handbook',
    '',
    '# Policy B',
    '',
    'Body B',
    '',
    'Confidential',
    '',
    'Company Handbook',
    '',
    '# Policy C',
    '',
    'Body C',
    '',
    'Confidential'
  ].join('\n')

  const cleaned = __notebookParsingTestables.removeRepeatedDocxBoilerplateBlocks(text)
  assert.equal(cleaned.includes('Company Handbook'), false)
  assert.equal(cleaned.includes('Confidential'), false)
  assert.ok(cleaned.includes('Body A'))
  assert.ok(cleaned.includes('Body B'))
  assert.ok(cleaned.includes('Body C'))
})

test('docx segments split by headings and keep section locator', () => {
  const text = [
    '# Intro',
    '',
    'Overview paragraph',
    '',
    '## Specs',
    '',
    'Detail line 1',
    '',
    'Detail line 2'
  ].join('\n')

  const segments = __notebookParsingTestables.buildDocxSegments(text)
  assert.equal(segments.length, 2)
  assert.equal(segments[0]?.sourceLocator, 'section:Intro')
  assert.equal(segments[1]?.sourceLocator, 'section:Specs')
  assert.ok(segments[1]?.text.includes('Detail line 2'))
})

test('xlsx row expansion falls back to generic column names when first row is weak header', () => {
  const rows = [
    ['生产指令单'],
    ['订单号', 'TW001'],
    ['sku', 'A1']
  ]

  const text = __notebookParsingTestables.rowsToExpandedKeyValueText(rows)
  assert.match(text, /row_2: col_1=订单号; col_2=TW001/)
  assert.match(text, /row_3: col_1=sku; col_2=A1/)
})
