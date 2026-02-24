import { getCompanySettings } from '../repos/authRepo.js'
import {
  getPlatformAiSettings,
  getSubjectAiPolicy,
  incrementSubjectAiPolicyUsage,
  type AiCapabilityType,
  type AiSubjectType
} from '../repos/aiPolicyRepo.js'

export type AiRuntimePolicy = {
  managedByPlatform: boolean
  source: 'subject_ai_policies' | 'company_settings_fallback' | 'default'
  capabilityType: AiCapabilityType
  subjectType: AiSubjectType
  subjectId: string
  enabled: boolean
  expireAt: string | null
  quotaMonthlyRequests: number | null
  quotaUsedMonthlyRequests: number
  rejectionCode: 'CAPABILITY_DISABLED' | 'CAPABILITY_EXPIRED' | 'QUOTA_EXCEEDED' | null
}

function evaluatePolicy(params: {
  enabled: boolean
  expireAt: string | null
  quotaMonthlyRequests: number | null
  quotaUsedMonthlyRequests: number
}): AiRuntimePolicy['rejectionCode'] {
  if (!params.enabled) return 'CAPABILITY_DISABLED'

  if (params.expireAt) {
    const expiry = new Date(params.expireAt).getTime()
    if (Number.isFinite(expiry) && Date.now() > expiry) {
      return 'CAPABILITY_EXPIRED'
    }
  }

  if (
    params.quotaMonthlyRequests != null
    && Number.isFinite(params.quotaMonthlyRequests)
    && params.quotaUsedMonthlyRequests >= Number(params.quotaMonthlyRequests)
  ) {
    return 'QUOTA_EXCEEDED'
  }

  return null
}

export async function resolveAiRuntimePolicy(params: {
  subjectType: AiSubjectType
  subjectId: string
  capabilityType: AiCapabilityType
}): Promise<AiRuntimePolicy> {
  const policy = await getSubjectAiPolicy(params)
  if (policy) {
    const rejectionCode = evaluatePolicy({
      enabled: Boolean(policy.enabled),
      expireAt: policy.expire_at ? String(policy.expire_at) : null,
      quotaMonthlyRequests: policy.quota_monthly_requests == null ? null : Number(policy.quota_monthly_requests),
      quotaUsedMonthlyRequests: Number(policy.quota_used_monthly_requests || 0)
    })
    return {
      managedByPlatform: true,
      source: 'subject_ai_policies',
      capabilityType: params.capabilityType,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      enabled: Boolean(policy.enabled),
      expireAt: policy.expire_at ? String(policy.expire_at) : null,
      quotaMonthlyRequests: policy.quota_monthly_requests == null ? null : Number(policy.quota_monthly_requests),
      quotaUsedMonthlyRequests: Number(policy.quota_used_monthly_requests || 0),
      rejectionCode
    }
  }

  // Compatibility fallback for notebook until platform policies are provisioned.
  if (params.capabilityType === 'notebook_ai') {
    const legacy = await getCompanySettings(params.subjectId)
    if (legacy) {
      console.warn('[ai-policy] fallback to company_settings.notebook_ai_enabled', {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        capabilityType: params.capabilityType
      })
      const enabled = Boolean(legacy.notebook_ai_enabled)
      return {
        managedByPlatform: true,
        source: 'company_settings_fallback',
        capabilityType: params.capabilityType,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        enabled,
        expireAt: null,
        quotaMonthlyRequests: null,
        quotaUsedMonthlyRequests: 0,
        rejectionCode: enabled ? null : 'CAPABILITY_DISABLED'
      }
    }
  }

  return {
    managedByPlatform: true,
    source: 'default',
    capabilityType: params.capabilityType,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    enabled: false,
    expireAt: null,
    quotaMonthlyRequests: null,
    quotaUsedMonthlyRequests: 0,
    rejectionCode: 'CAPABILITY_DISABLED'
  }
}

export async function getPlatformCapabilityConfig(capabilityType: AiCapabilityType): Promise<Record<string, unknown>> {
  const row = await getPlatformAiSettings(capabilityType)
  return (row?.config || {}) as Record<string, unknown>
}

export async function consumeAiRuntimeUsage(params: {
  subjectType: AiSubjectType
  subjectId: string
  capabilityType: AiCapabilityType
}) {
  await incrementSubjectAiPolicyUsage(params)
}

