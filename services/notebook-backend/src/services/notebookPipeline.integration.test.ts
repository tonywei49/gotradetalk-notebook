import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseDocument } from './notebookParsing.js'
import { splitIntoChunks } from './notebookChunking.js'

test('integration: csv parse -> chunk', async () => {
  const csvBuffer = Buffer.from('name,price\napple,10\nbanana,20\n', 'utf8')
  const parsed = await parseDocument(csvBuffer, 'text/csv', 'products.csv')
  assert.equal(parsed.sourceType, 'csv')
  assert.match(parsed.text, /row 1/i)

  const chunks = splitIntoChunks(parsed.text, 60, 10)
  assert.ok(chunks.length >= 1)
  assert.ok(chunks[0].tokenCount > 0)
})

test('integration: xlsx parse -> chunk', async () => {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['sku', 'feature'],
    ['P001', 'voice call'],
    ['P002', 'screen share']
  ])
  XLSX.utils.book_append_sheet(wb, ws, 'Specs')
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const parsed = await parseDocument(xlsxBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'specs.xlsx')
  assert.equal(parsed.sourceType, 'xlsx')
  assert.match(parsed.text, /sheet:Specs/i)
  assert.match(parsed.sourceLocator || '', /Specs:R1-R3/)

  const chunks = splitIntoChunks(parsed.text, 80, 20)
  assert.ok(chunks.length >= 1)
})
