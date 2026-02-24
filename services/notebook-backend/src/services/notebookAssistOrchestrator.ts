import { insertAssistLog } from '../repos/notebookRepo.js'
import { hybridSearchNotebook } from './notebookIndexing.js'
import { generateAssistAnswer, getNotebookAiConfig } from './notebookLlm.js'

export async function runNotebookAssist(params: {
  companyId: string
  userId: string
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
    query: params.queryText,
    topK: params.topK
  })

  const aiConfig = await getNotebookAiConfig(params.companyId)
  const blocks = sources.map((s) => ({
    source: `${s.title || s.item_id}${s.source_locator ? ` (${s.source_locator})` : ''}`,
    text: s.snippet
  }))

  const { answer, confidence } = await generateAssistAnswer(aiConfig, params.queryText, blocks, params.responseLang)

  await insertAssistLog({
    companyId: params.companyId,
    userId: params.userId,
    roomId: params.roomId || null,
    triggerType: params.triggerType,
    triggerEventId: params.triggerEventId,
    queryText: params.queryText,
    contextMessageIds: params.contextMessageIds || null,
    usedSources: sources,
    responseText: answer,
    responseConfidence: confidence,
    adoptedAction: 'none',
    latencyMs: Date.now() - params.startAtMs
  })

  return {
    answer,
    sources,
    citations: sources.map((s, idx) => ({ source_id: `${s.item_id}:${idx + 1}`, locator: s.source_locator })),
    confidence,
    guardrail: {
      insufficient_evidence: answer.includes('知識庫未找到明確依據')
    }
  }
}
