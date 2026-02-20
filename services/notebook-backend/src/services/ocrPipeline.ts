import { runOcrProvider } from './ocrProvider.js'

export type OcrPipelineConfig = {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string | null
}

export async function runImageOcr(params: {
  image: Buffer
  mimeType: string
  fileName?: string | null
  config: OcrPipelineConfig
}) {
  if (!params.config.enabled) {
    throw new Error('OCR_DISABLED')
  }

  if (!params.config.baseUrl || !params.config.apiKey || !params.config.model) {
    throw new Error('OCR_CONFIG_INCOMPLETE')
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
  })

  return {
    text: String(result.text || '').trim()
  }
}

