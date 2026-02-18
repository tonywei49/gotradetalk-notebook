import { getCompanySettings, getProfileById } from '../repos/authRepo.js';
export const NOTEBOOK_BASIC_CAPABILITY = 'NOTEBOOK_BASIC';
export const NOTEBOOK_LLM_ASSIST_CAPABILITY = 'NOTEBOOK_LLM_ASSIST';
export const NOTEBOOK_RAG_ADMIN_CAPABILITY = 'NOTEBOOK_RAG_ADMIN';
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
    const settings = await getCompanySettings(companyId);
    const policy = {
        notebook_ai_enabled: Boolean(settings?.notebook_ai_enabled),
        allow_low_confidence_send: Boolean(settings?.notebook_ai_allow_low_confidence_send),
        retrieval_top_k: Number(settings?.notebook_ai_retrieval_top_k || 5),
        score_threshold: Number(settings?.notebook_ai_score_threshold || 0.35),
        max_context_tokens: Number(settings?.notebook_ai_max_context_tokens || 4096),
        ocr_enabled: Boolean(settings?.notebook_ai_ocr_enabled)
    };
    const capabilities = [NOTEBOOK_BASIC_CAPABILITY];
    if ((role === 'staff' || role === 'admin') && policy.notebook_ai_enabled) {
        capabilities.push(NOTEBOOK_LLM_ASSIST_CAPABILITY);
    }
    if (role === 'admin') {
        capabilities.push(NOTEBOOK_RAG_ADMIN_CAPABILITY);
    }
    return {
        userId: user.id,
        companyId,
        role,
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
    if (context.role === 'client') {
        sendNotebookError(res, 403, 'FORBIDDEN_ROLE');
        return false;
    }
    if (!context.capabilities.includes(NOTEBOOK_LLM_ASSIST_CAPABILITY)) {
        sendNotebookError(res, 403, 'CAPABILITY_DISABLED');
        return false;
    }
    return true;
}
