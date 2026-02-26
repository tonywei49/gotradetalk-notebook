import { insertAssistLog } from '../repos/notebookRepo.js'
import { hybridSearchNotebook } from './notebookIndexing.js'
import { generateAssistAnswer, getNotebookAiConfig } from './notebookLlm.js'
import { consumeAiRuntimeUsage } from './aiRuntimePolicy.js'

function computeAssistConfidence(scores: number[]) {
  if (scores.length === 0) return 0
  const normalized = scores.map((score) => {
    const n = Number(score)
    if (!Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 1) return 1
    return n
  })
  const top = normalized[0] ?? 0
  const avg = normalized.reduce((sum, n) => sum + n, 0) / normalized.length
  return Number((top * 0.7 + avg * 0.3).toFixed(3))
}

export async function runNotebookAssist(params: {
  companyId: string
  userId: string
  scope: 'personal' | 'company' | 'both'
  roomId?: string | null
  queryText: string
  topK: number
  responseLang: string
  triggerType: 'manual_query' | 'from_message_context'
  triggerEventId?: string
  contextMessageIds?: string[] | null
  startAtMs: number
}) {
  const sources = await hybridSearchNotebook({
    companyId: params.companyId,
    ownerUserId: params.userId,
    scope: params.scope,
    query: params.queryText,
    topK: params.topK
  })

  if (sources.length === 0) {
    const answer = '知識庫未找到明確依據'
    await insertAssistLog({
      companyId: params.companyId,
      userId: params.userId,
      roomId: params.roomId || null,
      triggerType: params.triggerType,
      triggerEventId: params.triggerEventId,
      queryText: params.queryText,
      contextMessageIds: params.contextMessageIds || null,
      usedSources: [],
      responseText: answer,
      responseConfidence: 0,
      adoptedAction: 'none',
      latencyMs: Date.now() - params.startAtMs
    })

    return {
      answer,
      sources: [],
      citations: [],
      confidence: 0,
      guardrail: {
        insufficient_evidence: true
      }
    }
  }

  const displaySources = sources.slice(0, 3)
  const aiConfig = await getNotebookAiConfig(params.companyId)
  const blocks = displaySources.map((s, idx) => ({
    source: `[${s.source_title || s.item_id}|S${idx + 1}]${s.source_locator ? ` ${s.source_locator}` : ''}`,
    text: s.snippet
  }))

  const { answer, summary, referenceAnswer } = await generateAssistAnswer(aiConfig, params.queryText, blocks, params.responseLang)
  const confidence = computeAssistConfidence(displaySources.map((source) => Number(source.score || 0)))

  await insertAssistLog({
    companyId: params.companyId,
    userId: params.userId,
    roomId: params.roomId || null,
    triggerType: params.triggerType,
    triggerEventId: params.triggerEventId,
    queryText: params.queryText,
    contextMessageIds: params.contextMessageIds || null,
    usedSources: displaySources,
    responseText: answer,
    responseConfidence: confidence,
    adoptedAction: 'none',
    latencyMs: Date.now() - params.startAtMs
  })

  await consumeAiRuntimeUsage({
    subjectType: 'company',
    subjectId: params.companyId,
    capabilityType: 'notebook_ai'
  }).catch((error: any) => {
    console.warn('[assist] quota usage update failed', error?.message || String(error))
  })

  return {
    answer,
    summary_text: summary,
    reference_answer: referenceAnswer,
    sources: displaySources,
    citations: displaySources.map((s, idx) => ({
      source_id: `${s.item_id}:${idx + 1}`,
      locator: s.source_locator,
      source_scope: s.source_scope,
      source_file_name: s.source_file_name
    })),
    confidence,
    guardrail: {
      insufficient_evidence: answer.includes('知識庫未找到明確依據')
    }
  }
}
