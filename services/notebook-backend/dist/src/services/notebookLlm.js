import { getCompanySettings } from '../repos/authRepo.js';
function normalizeBaseUrl(value) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
export async function getNotebookAiConfig(companyId) {
    const data = await getCompanySettings(companyId);
    return {
        enabled: Boolean(data?.notebook_ai_enabled),
        baseUrl: normalizeBaseUrl(String(data?.notebook_ai_llm_base_url || '')),
        apiKey: String(data?.notebook_ai_llm_api_key || ''),
        chatModel: String(data?.notebook_ai_chat_model || 'gpt-4o-mini'),
        embeddingModel: String(data?.notebook_ai_embedding_model || 'text-embedding-3-small'),
        rerankModel: data?.notebook_ai_rerank_model ? String(data.notebook_ai_rerank_model) : null,
        topK: Number(data?.notebook_ai_retrieval_top_k || 5),
        scoreThreshold: Number(data?.notebook_ai_score_threshold || 0.35),
        maxContextTokens: Number(data?.notebook_ai_max_context_tokens || 4096),
        allowLowConfidenceSend: Boolean(data?.notebook_ai_allow_low_confidence_send)
    };
}
function authHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
}
export async function createEmbedding(config, text) {
    if (!config.baseUrl || !config.apiKey) {
        throw new Error('CAPABILITY_DISABLED');
    }
    const resp = await fetch(`${config.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: authHeaders(config.apiKey),
        body: JSON.stringify({ model: config.embeddingModel, input: text })
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`EMBEDDING_FAILED: ${resp.status} ${body}`);
    }
    const body = await resp.json();
    const vector = body.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('EMBEDDING_EMPTY');
    }
    return vector;
}
export async function rerankCandidates(config, query, candidates) {
    if (!config.rerankModel || candidates.length === 0) {
        return candidates.map((item, index) => ({ ...item, index }));
    }
    const resp = await fetch(`${config.baseUrl}/v1/rerank`, {
        method: 'POST',
        headers: authHeaders(config.apiKey),
        body: JSON.stringify({
            model: config.rerankModel,
            query,
            documents: candidates.map((it) => it.text)
        })
    });
    if (!resp.ok) {
        return candidates.map((item, index) => ({ ...item, index }));
    }
    const body = await resp.json();
    const scores = new Map();
    for (const row of body.results || []) {
        scores.set(row.index, row.relevance_score);
    }
    return candidates
        .map((item, index) => ({ text: item.text, score: scores.get(index) ?? item.score, index }))
        .sort((a, b) => b.score - a.score);
}
export async function generateAssistAnswer(config, query, contextBlocks) {
    const contextText = contextBlocks.map((c, idx) => `[S${idx + 1}] ${c.source}\n${c.text}`).join('\n\n');
    const systemPrompt = [
        '你是 GoTradeTalk Notebook 助理。',
        '你只能依據提供的來源內容回答，不得捏造功能、規格、價格或承諾。',
        '若證據不足，必須回答「知識庫未找到明確依據」。',
        '每段關鍵結論都要標註來源編號，例如 [S1]。',
        '禁止使用未提供來源的資訊。'
    ].join('\n');
    const userPrompt = [
        `使用者問題：${query}`,
        '以下是可用來源：',
        contextText || '(無來源)',
        '請以繁體中文回答，並在最後輸出一行 CONFIDENCE:0~1。'
    ].join('\n\n');
    const resp = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: authHeaders(config.apiKey),
        body: JSON.stringify({
            model: config.chatModel,
            temperature: 0.2,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        })
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`MODEL_ERROR: ${resp.status} ${body}`);
    }
    const body = await resp.json();
    const content = String(body.choices?.[0]?.message?.content || '').trim();
    const match = content.match(/CONFIDENCE\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
    const confidence = match ? Number(match[1]) : 0.5;
    const answer = content.replace(/\n?CONFIDENCE\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/gi, '').trim() || '知識庫未找到明確依據';
    return { answer, confidence };
}
