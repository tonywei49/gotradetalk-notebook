import { dbQuery } from '../db.js'

export type AiCapabilityType = 'notebook_ai' | 'translation'
export type AiSubjectType = 'company'

export type PlatformAiSettingsRow = {
  capability_type: AiCapabilityType
  managed_by_platform: boolean
  config: Record<string, unknown> | null
}

export type SubjectAiPolicyRow = {
  subject_type: AiSubjectType
  subject_id: string
  capability_type: AiCapabilityType
  enabled: boolean
  expire_at: string | null
  quota_monthly_requests: number | null
  quota_used_monthly_requests: number
  quota_month_key: string
}

export async function getPlatformAiSettings(capabilityType: AiCapabilityType): Promise<PlatformAiSettingsRow | null> {
  const result = await dbQuery<PlatformAiSettingsRow>(
    `select capability_type::text as capability_type,
            managed_by_platform,
            config
       from public.platform_ai_settings
      where capability_type = $1
      limit 1`,
    [capabilityType]
  )
  return result.rows[0] || null
}

export async function getSubjectAiPolicy(params: {
  subjectType: AiSubjectType
  subjectId: string
  capabilityType: AiCapabilityType
}): Promise<SubjectAiPolicyRow | null> {
  const result = await dbQuery<SubjectAiPolicyRow>(
    `select subject_type::text as subject_type,
            subject_id::text as subject_id,
            capability_type::text as capability_type,
            enabled,
            expire_at::text as expire_at,
            quota_monthly_requests,
            quota_used_monthly_requests,
            quota_month_key
       from public.subject_ai_policies
      where subject_type = $1
        and subject_id = $2
        and capability_type = $3
      limit 1`,
    [params.subjectType, params.subjectId, params.capabilityType]
  )
  return result.rows[0] || null
}

export async function incrementSubjectAiPolicyUsage(params: {
  subjectType: AiSubjectType
  subjectId: string
  capabilityType: AiCapabilityType
}): Promise<void> {
  const monthKey = new Date().toISOString().slice(0, 7)
  await dbQuery(
    `update public.subject_ai_policies
        set quota_used_monthly_requests = case
              when quota_month_key = $4 then quota_used_monthly_requests + 1
              else 1
            end,
            quota_month_key = case
              when quota_month_key = $4 then quota_month_key
              else $4
            end
      where subject_type = $1
        and subject_id = $2
        and capability_type = $3`,
    [params.subjectType, params.subjectId, params.capabilityType, monthKey]
  )
}

