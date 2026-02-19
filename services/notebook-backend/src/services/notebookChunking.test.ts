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

test('splitIntoChunks prefers markdown heading boundaries', () => {
  const input = [
    '# Title',
    '',
    'intro '.repeat(40),
    '',
    '## Section A',
    '',
    'content-a '.repeat(50),
    '',
    '## Section B',
    '',
    'content-b '.repeat(50)
  ].join('\n')

  const chunks = splitIntoChunks(input, 280, 40)
  assert.ok(chunks.length >= 2)
  const hasSectionBoundary = chunks.some((chunk) => chunk.text.includes('## Section A') || chunk.text.includes('## Section B'))
  assert.equal(hasSectionBoundary, true)
})

test('splitIntoChunks always makes forward progress', () => {
  const input = 'x'.repeat(1500)
  const chunks = splitIntoChunks(input, 120, 119)
  assert.ok(chunks.length > 0)
  assert.ok(chunks.length <= input.length)
  assert.equal(chunks[0]?.chunkIndex, 0)
  assert.equal(chunks[chunks.length - 1]?.chunkIndex, chunks.length - 1)
})

test('splitIntoChunks avoids splitting inside code fences', () => {
  const input = [
    '# Guide',
    '',
    'Intro paragraph '.repeat(20),
    '',
    '```ts',
    ...new Array(120).fill('const x = 1;'),
    '```',
    '',
    'Outro paragraph '.repeat(20)
  ].join('\n')

  const chunks = splitIntoChunks(input, 420, 60)
  assert.ok(chunks.length >= 2)

  for (const chunk of chunks) {
    const fenceCount = (chunk.text.match(/```/g) || []).length
    assert.ok(fenceCount === 0 || fenceCount % 2 === 0)
  }
})
