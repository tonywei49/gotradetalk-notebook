import { fetchMatrixMediaBuffer, parseDocument } from './notebookParsing.js';
import { runImageOcr } from './ocrPipeline.js';
function isImageSource(mime, fileName) {
    const normalizedMime = String(mime || '').toLowerCase();
    const normalizedName = String(fileName || '').toLowerCase();
    return normalizedMime.startsWith('image/')
        || normalizedName.endsWith('.jpg')
        || normalizedName.endsWith('.jpeg')
        || normalizedName.endsWith('.png')
        || normalizedName.endsWith('.webp');
}
export async function extractItemSource(params) {
    const item = params.item;
    if (item.item_type === 'text') {
        const text = `${item.title || ''}\n${item.content_markdown || ''}`.trim();
        return { text, sourceType: 'text', sourceLocator: null };
    }
    if (!item.matrix_media_mxc || !params.matrixBaseUrl || !params.accessToken) {
        throw new Error('INVALID_CONTEXT');
    }
    const media = await fetchMatrixMediaBuffer(params.matrixBaseUrl, params.accessToken, item.matrix_media_mxc);
    if (isImageSource(item.matrix_media_mime, item.matrix_media_name)) {
        const ocrResult = await runImageOcr({
            image: media,
            mimeType: String(item.matrix_media_mime || 'image/jpeg'),
            fileName: item.matrix_media_name,
            config: params.ocr
        });
        return {
            text: ocrResult.text,
            sourceType: 'image_ocr',
            sourceLocator: item.matrix_media_name || item.matrix_media_mxc
        };
    }
    const parsed = await parseDocument(media, item.matrix_media_mime, item.matrix_media_name);
    return {
        text: parsed.text,
        sourceType: parsed.sourceType,
        sourceLocator: parsed.sourceLocator || null
    };
}
