import { resolveNotebookAccessContext, sendNotebookError } from '../services/notebookAuth.js';
import { resolveAiRuntimePolicy } from '../services/aiRuntimePolicy.js';
async function resolveCompanyContext(req, res) {
    const context = await resolveNotebookAccessContext(req);
    if (!context) {
        sendNotebookError(res, 401, 'UNAUTHORIZED');
        return null;
    }
    return context;
}
function mapPolicyResponse(policy, enabledKey, expireKey, quotaKey, usedKey) {
    return {
        managed_by_platform: true,
        [enabledKey]: policy.rejectionCode == null,
        [expireKey]: policy.expireAt,
        [quotaKey]: policy.quotaMonthlyRequests,
        [usedKey]: policy.quotaUsedMonthlyRequests
    };
}
export async function getCompanyNotebookAiSettings(req, res) {
    const context = await resolveCompanyContext(req, res);
    if (!context)
        return;
    const policy = await resolveAiRuntimePolicy({
        subjectType: 'company',
        subjectId: context.companyId,
        capabilityType: 'notebook_ai'
    });
    return res.json({
        ...mapPolicyResponse(policy, 'notebook_ai_enabled', 'notebook_ai_expire_at', 'notebook_ai_quota_monthly_requests', 'notebook_ai_quota_used_monthly_requests'),
        notebook_upload_max_mb: Number(context.policy.notebook_upload_max_mb || 20)
    });
}
export async function getCompanyTranslationSettings(req, res) {
    const context = await resolveCompanyContext(req, res);
    if (!context)
        return;
    const policy = await resolveAiRuntimePolicy({
        subjectType: 'company',
        subjectId: context.companyId,
        capabilityType: 'translation'
    });
    return res.json(mapPolicyResponse(policy, 'translation_enabled', 'translation_expire_at', 'translation_quota_monthly_requests', 'translation_quota_used_monthly_requests'));
}
export async function rejectManagedNotebookAiUpdate(req, res) {
    const context = await resolveCompanyContext(req, res);
    if (!context)
        return;
    return sendNotebookError(res, 403, 'MANAGED_BY_PLATFORM');
}
export async function rejectManagedTranslationUpdate(req, res) {
    const context = await resolveCompanyContext(req, res);
    if (!context)
        return;
    return sendNotebookError(res, 403, 'MANAGED_BY_PLATFORM');
}
