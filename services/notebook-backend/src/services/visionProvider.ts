export type VisionProviderConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export type VisionProviderInput = {
  image: Buffer
  mimeType: string
  fileName?: string | null
  config: VisionProviderConfig
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function extractTextFromChatContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  const lines = content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)

  return lines.join('\n').trim()
}

export async function runVisionProvider(input: VisionProviderInput): Promise<string> {
  const baseUrl = normalizeBaseUrl(String(input.config.baseUrl || '').trim())
  const apiKey = String(input.config.apiKey || '').trim()
  const model = String(input.config.model || '').trim()

  if (!baseUrl || !apiKey || !model) {
    throw new Error('VISION_CONFIG_INCOMPLETE')
  }

  const imageData = input.image.toString('base64')
  const imageUrl = `data:${input.mimeType || 'image/jpeg'};base64,${imageData}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)

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
            content: '你是圖片理解助手。請簡短描述圖片中的場景、物件與可讀文字，不要臆測。'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '請描述這張圖片的內容，並包含可見文字。' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ]
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`VISION_FAILED: ${response.status} ${body}`)
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = extractTextFromChatContent(body.choices?.[0]?.message?.content)
    if (!content) {
      throw new Error('VISION_EMPTY')
    }

    return content
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('VISION_TIMEOUT')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
