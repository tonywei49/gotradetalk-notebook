// Provider adapter entry point. We keep this isolated so the OCR vendor/API
// can be swapped without changing indexing code.
export async function runOcrProvider(_input) {
    throw new Error('OCR_PROVIDER_NOT_IMPLEMENTED');
}
