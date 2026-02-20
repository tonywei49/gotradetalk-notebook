import { runOcrProvider } from './ocrProvider.js';
export async function runImageOcr(params) {
    if (!params.config.enabled) {
        throw new Error('OCR_DISABLED');
    }
    if (!params.config.baseUrl || !params.config.apiKey || !params.config.model) {
        throw new Error('OCR_CONFIG_INCOMPLETE');
    }
    const result = await runOcrProvider({
        image: params.image,
        mimeType: params.mimeType,
        fileName: params.fileName,
        config: {
            baseUrl: params.config.baseUrl,
            apiKey: params.config.apiKey,
            model: params.config.model
        }
    });
    return {
        text: String(result.text || '').trim()
    };
}
