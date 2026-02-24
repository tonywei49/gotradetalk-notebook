import { getCompanySettings } from '../repos/authRepo.js'
import { getPlatformCapabilityConfig, resolveAiRuntimePolicy } from './aiRuntimePolicy.js'

const NOTEBOOK_AI_DEFAULT_BASE_URL = 'https://api.siliconflow.cn'
const NOTEBOOK_AI_DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B'
const NOTEBOOK_AI_DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3'
const NOTEBOOK_AI_DEFAULT_OCR_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5'
const NOTEBOOK_AI_DEFAULT_VISION_MODEL = ''

export type NotebookAiConfig = {
  enabled: boolean
  chatBaseUrl: string
  chatApiKey: string
  embeddingBaseUrl: string
  embeddingApiKey: string
  rerankBaseUrl: string
  rerankApiKey: string
  ocrBaseUrl: string
  ocrApiKey: string
  visionBaseUrl: string
  visionApiKey: string
  chatModel: string
  embeddingModel: string
  rerankModel: string | null
  ocrModel: string | null
  visionModel: string | null
  ocrEnabled: boolean
  topK: number
  scoreThreshold: number
  maxContextTokens: number
  allowLowConfidenceSend: boolean
}

function normalizeResponseLanguage(value?: string | null): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 'zh-TW'
  return normalized
}

function buildLanguageInstruction(language: string): string {
  const lang = normalizeResponseLanguage(language)

  if (lang === 'zh-tw' || lang === 'zh_hant' || lang === 'zh-hant') {
    return '請以繁體中文回答，並在最後輸出一行 CONFIDENCE:0~1。'
  }
  if (lang === 'zh-cn' || lang === 'zh_hans' || lang === 'zh-hans') {
    return '請以簡體中文回答，並在最後輸出一行 CONFIDENCE:0~1。'
  }
  if (lang.startsWith('zh')) {
    return '請以中文回答，並在最後輸出一行 CONFIDENCE:0~1。'
  }
  if (lang.startsWith('en')) {
    return 'Please answer in English and append one line at the end: CONFIDENCE:0~1.'
  }
  if (lang.startsWith('ja')) {
    return '日本語で回答し、最後に1行で CONFIDENCE:0~1 を出力してください。'
  }
  if (lang.startsWith('ko')) {
    return '한국어로 답변하고 마지막 줄에 CONFIDENCE:0~1을 출력하세요.'
  }
  if (lang.startsWith('vi')) {
    return 'Vui lòng trả lời bằng tiếng Việt và thêm một dòng cuối: CONFIDENCE:0~1.'
  }

  return `Please answer in ${language} and append one line at the end: CONFIDENCE:0~1.`
}

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export async function getNotebookAiConfig(companyId: string): Promise<NotebookAiConfig> {
  const runtimePolicy = await resolveAiRuntimePolicy({
    subjectType: 'company',
    subjectId: companyId,
    capabilityType: 'notebook_ai'
  })
  if (runtimePolicy.rejectionCode) {
    throw new Error(runtimePolicy.rejectionCode)
  }

  const data = await getCompanySettings(companyId)
  const platformConfig = await getPlatformCapabilityConfig('notebook_ai')
  const defaultBaseUrl = normalizeBaseUrl(NOTEBOOK_AI_DEFAULT_BASE_URL)
  const getConfigValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = (platformConfig as any)?.[key]
      if (value !== undefined && value !== null && String(value).trim() !== '') return value
    }
    return undefined
  }
  if (Object.keys(platformConfig).length === 0) {
    console.warn('[notebook-llm] missing platform_ai_settings.notebook_ai config; fallback to company_settings')
  }

  return {
    enabled: true,
    chatBaseUrl: normalizeBaseUrl(String(getConfigValue('chat_base_url', 'notebook_ai_chat_base_url') || data?.notebook_ai_chat_base_url || defaultBaseUrl)),
    chatApiKey: String(getConfigValue('chat_api_key', 'notebook_ai_chat_api_key') || data?.notebook_ai_chat_api_key || ''),
    embeddingBaseUrl: normalizeBaseUrl(String(getConfigValue('embedding_base_url', 'notebook_ai_embedding_base_url') || data?.notebook_ai_embedding_base_url || defaultBaseUrl)),
    embeddingApiKey: String(getConfigValue('embedding_api_key', 'notebook_ai_embedding_api_key') || data?.notebook_ai_embedding_api_key || ''),
    rerankBaseUrl: normalizeBaseUrl(String(getConfigValue('rerank_base_url', 'notebook_ai_rerank_base_url') || data?.notebook_ai_rerank_base_url || defaultBaseUrl)),
    rerankApiKey: String(getConfigValue('rerank_api_key', 'notebook_ai_rerank_api_key') || data?.notebook_ai_rerank_api_key || ''),
    ocrBaseUrl: normalizeBaseUrl(String(getConfigValue('ocr_base_url', 'notebook_ai_ocr_base_url') || data?.notebook_ai_ocr_base_url || defaultBaseUrl)),
    ocrApiKey: String(getConfigValue('ocr_api_key', 'notebook_ai_ocr_api_key') || data?.notebook_ai_ocr_api_key || ''),
    visionBaseUrl: normalizeBaseUrl(String(
      getConfigValue('vision_base_url', 'notebook_ai_vision_base_url')
      || getConfigValue('chat_base_url', 'notebook_ai_chat_base_url')
      || data?.notebook_ai_vision_base_url
      || data?.notebook_ai_chat_base_url
      || defaultBaseUrl
    )),
    visionApiKey: String(
      getConfigValue('vision_api_key', 'notebook_ai_vision_api_key')
      || getConfigValue('chat_api_key', 'notebook_ai_chat_api_key')
      || data?.notebook_ai_vision_api_key
      || data?.notebook_ai_chat_api_key
      || ''
    ),
    chatModel: String(getConfigValue('chat_model', 'notebook_ai_chat_model') || data?.notebook_ai_chat_model || 'gpt-4o-mini'),
    embeddingModel: String(getConfigValue('embedding_model', 'notebook_ai_embedding_model') || data?.notebook_ai_embedding_model || NOTEBOOK_AI_DEFAULT_EMBEDDING_MODEL),
    rerankModel: getConfigValue('rerank_model', 'notebook_ai_rerank_model')
      ? String(getConfigValue('rerank_model', 'notebook_ai_rerank_model'))
      : data?.notebook_ai_rerank_model
      ? String(data.notebook_ai_rerank_model)
      : NOTEBOOK_AI_DEFAULT_RERANK_MODEL,
    ocrModel: getConfigValue('ocr_model', 'notebook_ai_ocr_model')
      ? String(getConfigValue('ocr_model', 'notebook_ai_ocr_model'))
      : data?.notebook_ai_ocr_model
      ? String(data.notebook_ai_ocr_model)
      : NOTEBOOK_AI_DEFAULT_OCR_MODEL,
    visionModel: getConfigValue('vision_model', 'notebook_ai_vision_model')
      ? String(getConfigValue('vision_model', 'notebook_ai_vision_model'))
      : data?.notebook_ai_vision_model
      ? String(data.notebook_ai_vision_model)
      : (data?.notebook_ai_chat_model ? String(data.notebook_ai_chat_model) : NOTEBOOK_AI_DEFAULT_VISION_MODEL) || null,
    ocrEnabled: Boolean(getConfigValue('ocr_enabled', 'notebook_ai_ocr_enabled') ?? data?.notebook_ai_ocr_enabled),
    topK: Number(getConfigValue('retrieval_top_k', 'notebook_ai_retrieval_top_k') || data?.notebook_ai_retrieval_top_k || 5),
    scoreThreshold: Number(getConfigValue('score_threshold', 'notebook_ai_score_threshold') || data?.notebook_ai_score_threshold || 0.35),
    maxContextTokens: Number(getConfigValue('max_context_tokens', 'notebook_ai_max_context_tokens') || data?.notebook_ai_max_context_tokens || 4096),
    allowLowConfidenceSend: Boolean(getConfigValue('allow_low_confidence_send', 'notebook_ai_allow_low_confidence_send') ?? data?.notebook_ai_allow_low_confidence_send)
  }
}

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
}

export async function createEmbedding(config: NotebookAiConfig, text: string): Promise<number[]> {
  if (!config.embeddingBaseUrl || !config.embeddingApiKey) {
    throw new Error('CAPABILITY_DISABLED')
  }

  const resp = await fetch(`${config.embeddingBaseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: authHeaders(config.embeddingApiKey),
    body: JSON.stringify({ model: config.embeddingModel, input: text })
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`EMBEDDING_FAILED: ${resp.status} ${body}`)
  }

  const body = await resp.json() as { data?: Array<{ embedding?: number[] }> }
  const vector = body.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('EMBEDDING_EMPTY')
  }

  return vector
}

export async function rerankCandidates(
  config: NotebookAiConfig,
  query: string,
  candidates: Array<{ text: string; score: number }>
): Promise<Array<{ text: string; score: number; index: number }>> {
  if (!config.rerankModel || candidates.length === 0 || !config.rerankBaseUrl || !config.rerankApiKey) {
    return candidates.map((item, index) => ({ ...item, index }))
  }

  const resp = await fetch(`${config.rerankBaseUrl}/v1/rerank`, {
    method: 'POST',
    headers: authHeaders(config.rerankApiKey),
    body: JSON.stringify({
      model: config.rerankModel,
      query,
      documents: candidates.map((it) => it.text)
    })
  })

  if (!resp.ok) {
    return candidates.map((item, index) => ({ ...item, index }))
  }

  const body = await resp.json() as { results?: Array<{ index: number; relevance_score: number }> }
  const scores = new Map<number, number>()
  for (const row of body.results || []) {
    scores.set(row.index, row.relevance_score)
  }

  return candidates
    .map((item, index) => ({ text: item.text, score: scores.get(index) ?? item.score, index }))
    .sort((a, b) => b.score - a.score)
}

export async function generateAssistAnswer(
  config: NotebookAiConfig,
  query: string,
  contextBlocks: Array<{ source: string; text: string }>,
  responseLanguage?: string | null
): Promise<{ answer: string; confidence: number }> {
  if (!config.chatBaseUrl || !config.chatApiKey) {
    throw new Error('CAPABILITY_DISABLED')
  }

  const contextText = contextBlocks.map((c, idx) => `[S${idx + 1}] ${c.source}\n${c.text}`).join('\n\n')
  const languageInstruction = buildLanguageInstruction(responseLanguage || 'zh-TW')

  const systemPrompt = [
    '你是 GoTradeTalk Notebook 助理。',
    '你只能依據提供的來源內容回答，不得捏造功能、規格、價格或承諾。',
    '若證據不足，必須回答「知識庫未找到明確依據」。',
    '每段關鍵結論都要標註來源編號，例如 [S1]。',
    '禁止使用未提供來源的資訊。'
  ].join('\n')

  const userPrompt = [
    `使用者問題：${query}`,
    '以下是可用來源：',
    contextText || '(無來源)',
    languageInstruction
  ].join('\n\n')

  const resp = await fetch(`${config.chatBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(config.chatApiKey),
    body: JSON.stringify({
      model: config.chatModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`MODEL_ERROR: ${resp.status} ${body}`)
  }

  const body = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = String(body.choices?.[0]?.message?.content || '').trim()

  const match = content.match(/CONFIDENCE\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i)
  const confidence = match ? Number(match[1]) : 0.5
  const answer = content.replace(/\n?CONFIDENCE\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/gi, '').trim() || '知識庫未找到明確依據'

  return { answer, confidence }
}

export async function refineContextAssistQuery(
  config: NotebookAiConfig,
  params: {
    anchorText: string
    contextTexts: string[]
    responseLanguage?: string | null
  }
): Promise<string> {
  const anchorText = String(params.anchorText || '').trim()
  const contextTexts = (params.contextTexts || []).map((line) => String(line || '').trim()).filter(Boolean)
  const fallback = [anchorText, ...contextTexts].filter(Boolean).join('\n').trim()

  if (!fallback) return ''
  if (!config.chatBaseUrl || !config.chatApiKey) return fallback

  const languageInstruction = buildLanguageInstruction(params.responseLanguage || 'zh-TW')
  const systemPrompt = [
    '你是檢索查詢重寫器。',
    '任務：以「當前錨點句」作為主語意，將上文對話做為輔助，輸出最適合向知識庫檢索的查詢語句。',
    '必須保留主問題核心，不得改變使用者意圖。',
    '輸出只允許一行純文字，不要加前綴、編號、引號或解釋。',
    '可補上關鍵名詞、約束條件、同義詞，但避免冗長。'
  ].join('\n')

  const userPrompt = [
    `錨點句（主語意）：${anchorText || '(空)'}`,
    '上文輔助句：',
    contextTexts.length > 0 ? contextTexts.map((line, idx) => `${idx + 1}. ${line}`).join('\n') : '(無)',
    languageInstruction
  ].join('\n\n')

  try {
    const resp = await fetch(`${config.chatBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders(config.chatApiKey),
      body: JSON.stringify({
        model: config.chatModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    })

    if (!resp.ok) {
      return fallback
    }

    const body = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = String(body.choices?.[0]?.message?.content || '').trim()
    const oneLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
    return oneLine || fallback
  } catch {
    return fallback
  }
}
