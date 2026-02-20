export type OcrProviderConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type OcrProviderInput = {
  image: Buffer
  mimeType: string
  fileName?: string | null
  config: OcrProviderConfig
}

export type OcrProviderOutput = {
  text: string
}

// Provider adapter entry point. We keep this isolated so the OCR vendor/API
// can be swapped without changing indexing code.
export async function runOcrProvider(_input: OcrProviderInput): Promise<OcrProviderOutput> {
  throw new Error('OCR_PROVIDER_NOT_IMPLEMENTED')
}

