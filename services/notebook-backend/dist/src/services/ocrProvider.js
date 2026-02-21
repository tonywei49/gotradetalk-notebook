function normalizeBaseUrl(value) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
function extractTextFromChatContent(content) {
    if (typeof content === 'string')
        return content.trim();
    if (!Array.isArray(content))
        return '';
    const lines = content
        .map((part) => {
        if (!part || typeof part !== 'object')
            return '';
        const text = part.text;
        return typeof text === 'string' ? text : '';
    })
        .filter(Boolean);
    return lines.join('\n').trim();
}
// Provider adapter entry point. We keep this isolated so the OCR vendor/API
// can be swapped without changing indexing code.
export async function runOcrProvider(input) {
    const baseUrl = normalizeBaseUrl(String(input.config.baseUrl || '').trim());
    const apiKey = String(input.config.apiKey || '').trim();
    const model = String(input.config.model || '').trim();
    if (!baseUrl || !apiKey || !model) {
        throw new Error('OCR_CONFIG_INCOMPLETE');
    }
    const imageData = input.image.toString('base64');
    const imageUrl = `data:${input.mimeType || 'image/jpeg'};base64,${imageData}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                temperature: 0,
                messages: [
                    {
                        role: 'system',
                        content: '你是OCR助手。只输出图片中的可读文字，不要解释，不要补充。'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: '请提取这张图片中的文字内容。' },
                            { type: 'image_url', image_url: { url: imageUrl } }
                        ]
                    }
                ]
            }),
            signal: controller.signal
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`OCR_FAILED: ${response.status} ${body}`);
        }
        const body = await response.json();
        const content = extractTextFromChatContent(body.choices?.[0]?.message?.content);
        if (!content) {
            throw new Error('OCR_EMPTY');
        }
        return { text: content };
    }
    catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('OCR_TIMEOUT');
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
