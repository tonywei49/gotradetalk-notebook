import { getCompanySettings, getProfileById } from '../repos/authRepo.js';
import { resolveAiRuntimePolicy } from './aiRuntimePolicy.js';
export const NOTEBOOK_BASIC_CAPABILITY = 'NOTEBOOK_BASIC';
export const NOTEBOOK_LLM_ASSIST_CAPABILITY = 'NOTEBOOK_LLM_ASSIST';
export const NOTEBOOK_RAG_ADMIN_CAPABILITY = 'NOTEBOOK_RAG_ADMIN';
function isCompanyAdminMember(user, companyId) {
    const adminRoles = new Set(['admin', 'owner', 'company_admin']);
    return (user.memberships || []).some((m) => String(m.company_id || '') === companyId && adminRoles.has(String(m.role || '').toLowerCase()));
}
function toRole(userType, isEmployee) {
    if (userType === 'admin')
        return 'admin';
    if (userType === 'staff' || isEmployee)
        return 'staff';
    return 'client';
}
function dedupeCapabilities(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function resolveUploadMaxMb(value) {
    const raw = Number(value ?? process.env.NOTEBOOK_UPLOAD_MAX_MB_DEFAULT ?? 20);
    if (!Number.isFinite(raw) || raw <= 0)
        return 20;
    return Math.min(Math.max(Math.floor(raw), 1), 200);
}
export function sendNotebookError(res, status, code, message) {
    return res.status(status).json({ code, message: message || code });
}
export async function resolveNotebookAccessContext(req) {
    const user = req.user;
    if (!user?.id) {
        return null;
    }
    const profile = await getProfileById(user.id);
    if (!profile) {
        return null;
    }
    const companyId = String(profile.company_id || user.memberships?.[0]?.company_id || '').trim();
    if (!companyId) {
        return null;
    }
    const role = toRole(profile.user_type || user.userType, user.isEmployee);
    const isCompanyAdmin = role === 'admin' || isCompanyAdminMember(user, companyId);
    const settings = await getCompanySettings(companyId);
    const runtimePolicy = await resolveAiRuntimePolicy({
        subjectType: 'company',
        subjectId: companyId,
        capabilityType: 'notebook_ai'
    });
    const policy = {
        managed_by_platform: true,
        notebook_ai_enabled: runtimePolicy.rejectionCode == null,
        notebook_ai_expire_at: runtimePolicy.expireAt,
        notebook_ai_quota_monthly_requests: runtimePolicy.quotaMonthlyRequests,
        notebook_ai_quota_used_monthly_requests: runtimePolicy.quotaUsedMonthlyRequests,
        runtime_policy_source: runtimePolicy.source,
        runtime_rejection_code: runtimePolicy.rejectionCode,
        allow_low_confidence_send: Boolean(settings?.notebook_ai_allow_low_confidence_send),
        retrieval_top_k: Number(settings?.notebook_ai_retrieval_top_k || 5),
        score_threshold: Number(settings?.notebook_ai_score_threshold || 0.35),
        max_context_tokens: Number(settings?.notebook_ai_max_context_tokens || 4096),
        ocr_enabled: Boolean(settings?.notebook_ai_ocr_enabled),
        notebook_upload_max_mb: resolveUploadMaxMb(settings?.notebook_ai_upload_max_mb)
    };
    const capabilities = [NOTEBOOK_BASIC_CAPABILITY];
    if (policy.notebook_ai_enabled) {
        capabilities.push(NOTEBOOK_LLM_ASSIST_CAPABILITY);
    }
    if (role === 'admin') {
        capabilities.push(NOTEBOOK_RAG_ADMIN_CAPABILITY);
    }
    return {
        userId: user.id,
        companyId,
        role,
        isCompanyAdmin,
        capabilities: dedupeCapabilities(capabilities),
        policy
    };
}
export function ensureNotebookBasic(context, res) {
    if (!context.capabilities.includes(NOTEBOOK_BASIC_CAPABILITY)) {
        sendNotebookError(res, 403, 'CAPABILITY_DISABLED');
        return false;
    }
    return true;
}
export function ensureAssistAllowed(context, res) {
    if (context.policy.runtime_rejection_code === 'QUOTA_EXCEEDED') {
        sendNotebookError(res, 429, 'QUOTA_EXCEEDED');
        return false;
    }
    if (context.policy.runtime_rejection_code === 'CAPABILITY_EXPIRED') {
        sendNotebookError(res, 403, 'CAPABILITY_EXPIRED');
        return false;
    }
    if (!context.capabilities.includes(NOTEBOOK_LLM_ASSIST_CAPABILITY) || context.policy.runtime_rejection_code === 'CAPABILITY_DISABLED') {
        sendNotebookError(res, 403, 'CAPABILITY_DISABLED');
        return false;
    }
    return true;
}
