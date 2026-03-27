import test from 'node:test'
import assert from 'node:assert/strict'
import { generateAssistAnswer } from './notebookLlm.js'

const TEST_CONFIG = {
  enabled: true,
  chatBaseUrl: 'https://api.example.com',
  chatApiKey: 'test-key',
  embeddingBaseUrl: 'https://api.example.com',
  embeddingApiKey: 'embed-key',
  rerankBaseUrl: 'https://api.example.com',
  rerankApiKey: 'rerank-key',
  ocrBaseUrl: 'https://api.example.com',
  ocrApiKey: 'ocr-key',
  visionBaseUrl: 'https://api.example.com',
  visionApiKey: 'vision-key',
  chatModel: 'test-model',
  embeddingModel: 'embed-model',
  rerankModel: null,
  ocrModel: null,
  visionModel: null,
  ocrEnabled: false,
  topK: 5,
  scoreThreshold: 0.35,
  maxContextTokens: 4096,
  allowLowConfidenceSend: false
} as const

test('generateAssistAnswer keeps the full reply body when the model starts with a greeting', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: '你好！\n如果您支付30%预付款，交期可以评估压缩到25天内，但仍需以排产与物料情况确认。'
          }
        }
      ]
    })
  }) as any) as any

  try {
    const result = await generateAssistAnswer(
      TEST_CONFIG,
      '如果我給30%預付款，可以做到25天嗎？',
      [{ source: '[交期政策|S1]', text: '若支付30%预付款，可评估压缩到25天内，但需确认排产。' }],
      'zh-CN',
      { currentQuestion: '如果我給30%預付款，可以做到25天嗎？', priorMessages: [] }
    )

    assert.equal(
      result.referenceAnswer,
      '你好！\n如果您支付30%预付款，交期可以评估压缩到25天内，但仍需以排产与物料情况确认。'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generateAssistAnswer strips optional answer labels when present', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: '參考答案：若要趕在25天內出貨，需先確認排產與物料是否到位。'
          }
        }
      ]
    })
  }) as any) as any

  try {
    const result = await generateAssistAnswer(
      TEST_CONFIG,
      '可以25天出貨嗎？',
      [{ source: '[交期政策|S1]', text: '25天交付需确认排产与物料。' }],
      'zh-TW',
      { currentQuestion: '可以25天出貨嗎？', priorMessages: [] }
    )

    assert.equal(result.referenceAnswer, '若要趕在25天內出貨，需先確認排產與物料是否到位。')
  } finally {
    globalThis.fetch = originalFetch
  }
})
