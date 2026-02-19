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
