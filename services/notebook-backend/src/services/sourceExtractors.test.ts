import test from 'node:test'
import assert from 'node:assert/strict'
import { extractItemSources } from './sourceExtractors.js'

const ocrConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: null as string | null
}

const visionConfig = {
  baseUrl: '',
  apiKey: '',
  model: null as string | null,
  fallbackBaseUrl: '',
  fallbackApiKey: '',
  fallbackModel: null as string | null
}

test('extractItemSources: text item indexes title + content', async () => {
  const sources = await extractItemSources({
    item: {
      id: 'item-text-1',
      company_id: 'company-1',
      owner_user_id: 'owner-1',
      source_scope: 'personal',
      item_type: 'text',
      content_markdown: 'Body content',
      title: 'My title',
      matrix_media_mxc: null,
      matrix_media_name: null,
      matrix_media_mime: null,
      is_indexable: true
    },
    ocr: ocrConfig,
    vision: visionConfig
  })

  assert.equal(sources.length, 1)
  assert.equal(sources[0]?.sourceType, 'text')
  assert.match(sources[0]?.text || '', /My title/)
  assert.match(sources[0]?.text || '', /Body content/)
})

test('extractItemSources: file item also indexes title + content even without file attachment context', async () => {
  const sources = await extractItemSources({
    item: {
      id: 'item-file-1',
      company_id: 'company-1',
      owner_user_id: 'owner-1',
      source_scope: 'personal',
      item_type: 'file',
      content_markdown: 'Supplement note for retrieval',
      title: 'Spec PDF',
      matrix_media_mxc: null,
      matrix_media_name: null,
      matrix_media_mime: null,
      is_indexable: true
    },
    files: [],
    ocr: ocrConfig,
    vision: visionConfig
  })

  assert.equal(sources.length, 1)
  assert.equal(sources[0]?.sourceType, 'text')
  assert.match(sources[0]?.text || '', /Spec PDF/)
  assert.match(sources[0]?.text || '', /Supplement note for retrieval/)
})
