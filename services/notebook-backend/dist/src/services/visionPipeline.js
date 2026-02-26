import { runVisionProvider } from './visionProvider.js';
export async function runImageVisionCaption(params) {
    if (!params.config.baseUrl || !params.config.apiKey || !params.config.model) {
        return null;
    }
    const caption = await runVisionProvider({
        image: params.image,
        mimeType: params.mimeType,
        fileName: params.fileName,
        config: {
            baseUrl: params.config.baseUrl,
            apiKey: params.config.apiKey,
            model: params.config.model
        }
    });
    return String(caption || '').trim() || null;
}
