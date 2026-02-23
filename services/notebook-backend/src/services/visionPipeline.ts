import { runVisionProvider } from './visionProvider.js'

export type VisionPipelineConfig = {
  baseUrl: string
  apiKey: string
  model: string | null
}

export async function runImageVisionCaption(params: {
  image: Buffer
  mimeType: string
  fileName?: string | null
  config: VisionPipelineConfig
}): Promise<string | null> {
  if (!params.config.baseUrl || !params.config.apiKey || !params.config.model) {
    return null
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
  })

  return String(caption || '').trim() || null
}
