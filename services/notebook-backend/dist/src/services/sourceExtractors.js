import { fetchMatrixMediaBuffer, parseDocument } from './notebookParsing.js';
import { runImageOcr } from './ocrPipeline.js';
import { runImageVisionCaption } from './visionPipeline.js';
function buildInlineTextSource(item) {
    const text = `${item.title || ''}\n${item.content_markdown || ''}`.trim();
    if (!text)
        return null;
    return { text, sourceType: 'text', sourceLocator: null };
}
function isImageSource(mime, fileName) {
    const normalizedMime = String(mime || '').toLowerCase();
    const normalizedName = String(fileName || '').toLowerCase();
    return normalizedMime.startsWith('image/')
        || normalizedName.endsWith('.jpg')
        || normalizedName.endsWith('.jpeg')
        || normalizedName.endsWith('.png')
        || normalizedName.endsWith('.webp');
}
async function extractSingleFileSource(params) {
    const file = params.file;
    if (!file.matrix_media_mxc || !params.matrixBaseUrl) {
        throw new Error('INVALID_CONTEXT');
    }
    const media = await fetchMatrixMediaBuffer(params.matrixBaseUrl, params.accessToken, file.matrix_media_mxc);
    if (isImageSource(file.matrix_media_mime, file.matrix_media_name)) {
        const ocrResult = await runImageOcr({
            image: media,
            mimeType: String(file.matrix_media_mime || 'image/jpeg'),
            fileName: file.matrix_media_name,
            config: params.ocr
        });
        let visionCaption = null;
        try {
            visionCaption = await runImageVisionCaption({
                image: media,
                mimeType: String(file.matrix_media_mime || 'image/jpeg'),
                fileName: file.matrix_media_name,
                config: {
                    baseUrl: params.vision.baseUrl,
                    apiKey: params.vision.apiKey,
                    model: params.vision.model
                }
            });
            if (!visionCaption) {
                visionCaption = await runImageVisionCaption({
                    image: media,
                    mimeType: String(file.matrix_media_mime || 'image/jpeg'),
                    fileName: file.matrix_media_name,
                    config: {
                        baseUrl: params.vision.fallbackBaseUrl,
                        apiKey: params.vision.fallbackApiKey,
                        model: params.vision.fallbackModel
                    }
                });
            }
        }
        catch {
            visionCaption = null;
        }
        const combinedText = [
            ocrResult.text ? `OCR:\n${ocrResult.text}` : '',
            visionCaption ? `Vision:\n${visionCaption}` : ''
        ].filter(Boolean).join('\n\n');
        return {
            text: combinedText || ocrResult.text,
            sourceType: 'image_ocr',
            sourceLocator: file.matrix_media_name || file.matrix_media_mxc
        };
    }
    const parsed = await parseDocument(media, file.matrix_media_mime, file.matrix_media_name);
    return {
        text: parsed.text,
        sourceType: parsed.sourceType,
        sourceLocator: parsed.sourceLocator || file.matrix_media_name || file.matrix_media_mxc
    };
}
export async function extractItemSources(params) {
    const item = params.item;
    if (item.item_type === 'text') {
        const inlineSource = buildInlineTextSource(item);
        return inlineSource ? [inlineSource] : [];
    }
    const outputs = [];
    const inlineSource = buildInlineTextSource(item);
    if (inlineSource)
        outputs.push(inlineSource);
    const files = (params.files || [])
        .filter((file) => file.is_indexable && Boolean(file.matrix_media_mxc));
    if (files.length > 0) {
        for (const file of files) {
            outputs.push(await extractSingleFileSource({
                file,
                matrixBaseUrl: params.matrixBaseUrl,
                accessToken: params.accessToken,
                ocr: params.ocr,
                vision: params.vision
            }));
        }
        return outputs;
    }
    if (!item.is_indexable || !item.matrix_media_mxc) {
        return outputs;
    }
    const fallback = await extractSingleFileSource({
        file: {
            id: item.id,
            matrix_media_mxc: item.matrix_media_mxc,
            matrix_media_name: item.matrix_media_name || null,
            matrix_media_mime: item.matrix_media_mime || null,
            is_indexable: item.is_indexable
        },
        matrixBaseUrl: params.matrixBaseUrl,
        accessToken: params.accessToken,
        ocr: params.ocr,
        vision: params.vision
    });
    outputs.push(fallback);
    return outputs;
}
