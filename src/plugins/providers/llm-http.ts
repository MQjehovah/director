import type { ProviderPlugin } from '../../core/plugin/types'
import type { ChatMessage, LLMProvider } from '../../providers/LLMProvider'
import { loadProviderConfig } from '../../features/settings/httpBackendConfig'

export const LLM_HTTP_ID = 'llm-http'

/**
 * OpenAI 兼容协议（/chat/completions）的 LLM Provider。
 * 配置（baseUrl/apiKey/model）由设置页写入 localStorage，每次请求时读取，
 * 修改配置后无需重启即生效。
 */
export function createLLMHttpProvider(): LLMProvider {
  function readConfig(): { baseUrl: string; apiKey: string; model: string } {
    const config = loadProviderConfig(LLM_HTTP_ID) ?? {}
    const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '')
    const apiKey = String(config.apiKey ?? '')
    const model = String(config.model ?? '')
    if (!baseUrl || !apiKey) {
      throw new Error(
        'HTTP LLM 未配置：请在「设置 → HTTP LLM」填写地址（Base URL）与 Token/密钥。',
      )
    }
    if (!model) {
      throw new Error('HTTP LLM 未配置模型名：请在「设置 → HTTP LLM」填写模型名。')
    }
    return { baseUrl, apiKey, model }
  }

  function buildBody(messages: ChatMessage[], model: string, stream: boolean): string {
    return JSON.stringify({ model, messages, stream })
  }

  function buildHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }
  }

  async function request(
    messages: ChatMessage[],
    stream: boolean,
  ): Promise<Response> {
    const { baseUrl, apiKey, model } = readConfig()
    let res: Response
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: buildBody(messages, model, stream),
      })
    } catch (err) {
      throw new Error(
        `HTTP LLM 请求失败（网络错误或 CORS 限制）：${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP LLM 请求失败（${res.status}）：${text.slice(0, 200)}`)
    }
    return res
  }

  async function complete(prompt: string): Promise<string> {
    const res = await request([{ role: 'user', content: prompt }], false)
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('HTTP LLM 返回格式异常：缺少 choices[0].message.content')
    }
    return content
  }

  async function* chat(messages: ChatMessage[]): AsyncGenerator<string> {
    const res = await request(messages, true)
    const body = res.body
    if (!body) throw new Error('HTTP LLM 流式响应缺少 body')
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch {
          // 跳过无法解析的 SSE 帧
        }
      }
    }
  }

  return {
    id: LLM_HTTP_ID,
    name: 'HTTP LLM',
    models: [{ id: 'configured', name: '设置页配置的模型' }],
    chat,
    complete,
  }
}

export function createLLMHttpPlugin(): ProviderPlugin<LLMProvider> {
  const instance = createLLMHttpProvider()
  return {
    id: LLM_HTTP_ID,
    name: 'HTTP LLM',
    kind: 'provider',
    providerType: 'llm',
    enabled: true,
    description: 'OpenAI 兼容协议（/chat/completions），在下方填写地址、密钥与模型名后使用。',
    configFields: ['baseUrl', 'apiKey', 'model'],
    instance,
  }
}
