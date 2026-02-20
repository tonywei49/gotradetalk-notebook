import { dbQuery } from '../db.js';
const NOTEBOOK_SETTINGS_COLUMNS = [
    'notebook_ai_enabled',
    'notebook_ai_llm_base_url',
    'notebook_ai_llm_api_key',
    'notebook_ai_chat_base_url',
    'notebook_ai_chat_api_key',
    'notebook_ai_chat_model',
    'notebook_ai_embedding_base_url',
    'notebook_ai_embedding_api_key',
    'notebook_ai_embedding_model',
    'notebook_ai_rerank_base_url',
    'notebook_ai_rerank_api_key',
    'notebook_ai_rerank_model',
    'notebook_ai_ocr_base_url',
    'notebook_ai_ocr_api_key',
    'notebook_ai_ocr_model',
    'notebook_ai_retrieval_top_k',
    'notebook_ai_score_threshold',
    'notebook_ai_max_context_tokens',
    'notebook_ai_ocr_enabled',
    'notebook_ai_allow_low_confidence_send'
];
const ALLOWED_UPDATE_KEYS = new Set(NOTEBOOK_SETTINGS_COLUMNS);
function getInternalSecret() {
    return String(process.env.NOTEBOOK_ADMIN_SYNC_SECRET || '').trim();
}
function authorized(req) {
    const expected = getInternalSecret();
    if (!expected)
        return false;
    const provided = String(req.headers['x-notebook-admin-secret'] || '').trim();
    return Boolean(provided && provided === expected);
}
function resolveCompanyId(req) {
    const fromHeader = String(req.headers['x-company-id'] || '').trim();
    const fromQuery = String(req.query.company_id || '').trim();
    const fromBody = String(req.body?.company_id || '').trim();
    return fromHeader || fromQuery || fromBody;
}
export async function getInternalNotebookAiSettings(req, res) {
    if (!authorized(req)) {
        return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' });
    }
    const companyId = resolveCompanyId(req);
    if (!companyId) {
        return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id is required' });
    }
    const result = await dbQuery(`select ${NOTEBOOK_SETTINGS_COLUMNS.join(', ')}
     from public.company_settings
     where company_id = $1
     limit 1`, [companyId]);
    return res.json({ settings: result.rows[0] || null });
}
export async function upsertInternalNotebookAiSettings(req, res) {
    if (!authorized(req)) {
        return res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid internal secret' });
    }
    const companyId = resolveCompanyId(req);
    if (!companyId) {
        return res.status(400).json({ code: 'INVALID_INPUT', message: 'company_id is required' });
    }
    const updates = (req.body?.updates || {});
    const keys = Object.keys(updates).filter((key) => ALLOWED_UPDATE_KEYS.has(key));
    if (keys.length === 0) {
        return res.status(400).json({ code: 'INVALID_INPUT', message: 'No valid updates' });
    }
    const allColumns = ['company_id', ...keys];
    const values = [companyId, ...keys.map((key) => updates[key])];
    const placeholders = allColumns.map((_, idx) => `$${idx + 1}`);
    const updateExpr = keys.map((key) => `${key} = excluded.${key}`);
    await dbQuery(`insert into public.company_settings (${allColumns.join(', ')})
     values (${placeholders.join(', ')})
     on conflict (company_id) do update set ${updateExpr.join(', ')}`, values);
    return res.json({ ok: true });
}
