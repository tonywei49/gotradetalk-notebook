import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseDocument } from './notebookParsing.js'
import { splitIntoChunks } from './notebookChunking.js'

test('integration: csv parse -> chunk', async () => {
  const csvBuffer = Buffer.from('name,price\napple,10\nbanana,20\n', 'utf8')
  const parsed = await parseDocument(csvBuffer, 'text/csv', 'products.csv')
  assert.equal(parsed.sourceType, 'csv')
  assert.match(parsed.text, /\| name \| price \|/i)
  assert.match(parsed.text, /\| apple \| 10 \|/i)

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
  assert.match(parsed.text, /## Sheet: Specs/i)
  assert.match(parsed.text, /\| sku \| feature \|/i)
  assert.match(parsed.text, /row_2: sku=P001; feature=voice call/i)
  assert.match(parsed.sourceLocator || '', /sheet:Specs row:1-3/)
  assert.equal(parsed.segments?.length, 1)
  assert.match(parsed.segments?.[0]?.sourceLocator || '', /sheet:Specs row:1-3/)

  const chunks = splitIntoChunks(parsed.text, 80, 20)
  assert.ok(chunks.length >= 1)
})

test('integration: xlsx multi-sheet keeps per-block locators', async () => {
  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['order_no', 'qty'],
    ['TW001', '10'],
    [],
    ['sku', 'color'],
    ['A1', 'blue']
  ])
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['part', 'material'],
    ['pump', 'PVC']
  ])
  XLSX.utils.book_append_sheet(wb, ws1, 'Orders')
  XLSX.utils.book_append_sheet(wb, ws2, 'Parts')
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const parsed = await parseDocument(xlsxBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'multi.xlsx')
  assert.equal(parsed.sourceType, 'xlsx')
  assert.match(parsed.text, /## Sheet: Orders/i)
  assert.match(parsed.text, /## Sheet: Parts/i)
  assert.equal(parsed.segments?.length, 3)
  assert.deepEqual(
    parsed.segments?.map((segment) => segment.sourceLocator),
    ['sheet:Orders row:1-2', 'sheet:Orders row:4-5', 'sheet:Parts row:1-2']
  )
})

test('integration: xlsx cleanup preserves original row locators after repeated edge removal', async () => {
  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['生产指令单'],
    ['订单号', 'TW001'],
    ['sku', 'A1'],
    ['备注：内部使用']
  ])
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['生产指令单'],
    ['订单号', 'TW002'],
    ['sku', 'A2'],
    ['备注：内部使用']
  ])
  XLSX.utils.book_append_sheet(wb, ws1, 'One')
  XLSX.utils.book_append_sheet(wb, ws2, 'Two')
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const parsed = await parseDocument(xlsxBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'clean.xlsx')
  assert.equal(parsed.segments?.length, 2)
  assert.deepEqual(
    parsed.segments?.map((segment) => segment.sourceLocator),
    ['sheet:One row:2-3', 'sheet:Two row:2-3']
  )
  assert.equal(parsed.text.includes('生产指令单'), false)
  assert.equal(parsed.text.includes('备注：内部使用'), false)
  assert.match(parsed.text, /row_2: 订单号=sku; TW001=A1/i)
})

test('integration: xlsx parser trims inflated worksheet range before extraction', async () => {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['关键词', '搜索量'],
    ['气垫床', '1200'],
    ['病床', '800']
  ])
  ws['!ref'] = 'A1:XFD5000'
  XLSX.utils.book_append_sheet(wb, ws, 'Keywords')
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const parsed = await parseDocument(
    xlsxBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'inflated-range.xlsx'
  )

  assert.equal(parsed.sourceType, 'xlsx')
  assert.match(parsed.text, /\| 关键词 \| 搜索量 \|/i)
  assert.match(parsed.text, /row_2: 关键词=气垫床; 搜索量=1200/i)
  assert.equal(parsed.text.includes('col_100'), false)
  assert.equal(parsed.segments?.length, 1)
})
