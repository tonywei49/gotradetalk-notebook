import type { Request, Response } from 'express'
import { supabaseAdmin } from '../supabase.js'
import type { RequestUser } from '../types.js'

export const NOTEBOOK_BASIC_CAPABILITY = 'NOTEBOOK_BASIC'
export const NOTEBOOK_LLM_ASSIST_CAPABILITY = 'NOTEBOOK_LLM_ASSIST'
export const NOTEBOOK_RAG_ADMIN_CAPABILITY = 'NOTEBOOK_RAG_ADMIN'

export type NotebookRole = 'staff' | 'client' | 'admin'

export type NotebookAccessContext = {
  userId: string
  companyId: string
  role: NotebookRole
  capabilities: string[]
  policy: {
    notebook_ai_enabled: boolean
    allow_low_confidence_send: boolean
    retrieval_top_k: number
    score_threshold: number
    max_context_tokens: number
    ocr_enabled: boolean
  }
}

function toRole(userType: string | undefined, isEmployee: boolean): NotebookRole {
  if (userType === 'admin') return 'admin'
  if (userType === 'staff' || isEmployee) return 'staff'
  return 'client'
}

function dedupeCapabilities(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

export function sendNotebookError(res: Response, status: number, code: string, message?: string) {
  return res.status(status).json({ code, message: message || code })
}

export async function resolveNotebookAccessContext(req: Request): Promise<NotebookAccessContext | null> {
  const user = (req as any).user as RequestUser | undefined
  if (!user?.id) {
    return null
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, company_id, user_type')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) {
    return null
  }

  const companyId = String(profile.company_id || user.memberships?.[0]?.company_id || '').trim()
  if (!companyId) {
    return null
  }

  const role = toRole(profile.user_type || user.userType, user.isEmployee)

  const { data: settings } = await supabaseAdmin
    .from('company_settings')
    .select('notebook_ai_enabled, notebook_ai_allow_low_confidence_send, notebook_ai_retrieval_top_k, notebook_ai_score_threshold, notebook_ai_max_context_tokens, notebook_ai_ocr_enabled')
    .eq('company_id', companyId)
    .maybeSingle()

  const policy = {
    notebook_ai_enabled: Boolean(settings?.notebook_ai_enabled),
    allow_low_confidence_send: Boolean(settings?.notebook_ai_allow_low_confidence_send),
    retrieval_top_k: Number(settings?.notebook_ai_retrieval_top_k || 5),
    score_threshold: Number(settings?.notebook_ai_score_threshold || 0.35),
    max_context_tokens: Number(settings?.notebook_ai_max_context_tokens || 4096),
    ocr_enabled: Boolean(settings?.notebook_ai_ocr_enabled)
  }

  const capabilities = [NOTEBOOK_BASIC_CAPABILITY]

  if ((role === 'staff' || role === 'admin') && policy.notebook_ai_enabled) {
    capabilities.push(NOTEBOOK_LLM_ASSIST_CAPABILITY)
  }

  if (role === 'admin') {
    capabilities.push(NOTEBOOK_RAG_ADMIN_CAPABILITY)
  }

  return {
    userId: user.id,
    companyId,
    role,
    capabilities: dedupeCapabilities(capabilities),
    policy
  }
}

export function ensureNotebookBasic(context: NotebookAccessContext, res: Response): boolean {
  if (!context.capabilities.includes(NOTEBOOK_BASIC_CAPABILITY)) {
    sendNotebookError(res, 403, 'CAPABILITY_DISABLED')
    return false
  }
  return true
}

export function ensureAssistAllowed(context: NotebookAccessContext, res: Response): boolean {
  if (context.role === 'client') {
    sendNotebookError(res, 403, 'FORBIDDEN_ROLE')
    return false
  }

  if (!context.capabilities.includes(NOTEBOOK_LLM_ASSIST_CAPABILITY)) {
    sendNotebookError(res, 403, 'CAPABILITY_DISABLED')
    return false
  }

  return true
}
