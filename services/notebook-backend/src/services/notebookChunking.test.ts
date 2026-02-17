import test from 'node:test'
import assert from 'node:assert/strict'
import { splitIntoChunks } from './notebookChunking.js'

test('splitIntoChunks creates overlapping chunks', () => {
  const input = 'a'.repeat(2200)
  const chunks = splitIntoChunks(input, 1000, 200)
  assert.equal(chunks.length, 3)
  assert.ok(chunks[0].text.length >= 900)
  assert.ok(chunks[1].text.length >= 900)
  assert.equal(chunks[0].chunkIndex, 0)
  assert.equal(chunks[1].chunkIndex, 1)
  assert.equal(chunks[2].chunkIndex, 2)
})

test('splitIntoChunks returns empty for blank text', () => {
  const chunks = splitIntoChunks('   ', 1000, 200)
  assert.equal(chunks.length, 0)
})
