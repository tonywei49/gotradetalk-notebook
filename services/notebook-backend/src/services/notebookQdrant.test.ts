import test from 'node:test'
import assert from 'node:assert/strict'
import { __notebookQdrantTestables } from './notebookQdrant.js'

test('splitPointsForUpsert batches oversized point payloads into multiple requests', () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    id: `p-${index}`,
    vector: [0.1, 0.2, 0.3],
    payload: {
      text: 'x'.repeat(700),
      chunk_index: index
    }
  }))

  const batches = __notebookQdrantTestables.splitPointsForUpsert(points, {
    maxBytes: 2500,
    maxPoints: 10
  })

  assert.ok(batches.length > 1)
  assert.equal(batches.flat().length, points.length)
  assert.ok(batches.every((batch) => batch.length >= 1))
})

test('splitPointsForUpsert respects max point count even when payload is small', () => {
  const points = Array.from({ length: 9 }, (_, index) => ({
    id: `p-${index}`,
    vector: [0.1, 0.2, 0.3],
    payload: {
      text: 'ok',
      chunk_index: index
    }
  }))

  const batches = __notebookQdrantTestables.splitPointsForUpsert(points, {
    maxBytes: 1024 * 1024,
    maxPoints: 4
  })

  assert.deepEqual(batches.map((batch) => batch.length), [4, 4, 1])
})
