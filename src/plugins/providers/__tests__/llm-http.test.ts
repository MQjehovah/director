import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLLMHttpProvider } from '../llm-http'
import { saveProviderConfig, clearProviderConfig } from '../../../features/settings/httpBackendConfig'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as unknown as Response
}

describe('llm-http provider', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    clearProviderConfig('llm-http')
  })

  it('throws a clear error when baseUrl/apiKey is missing', async () => {
    const p = createLLMHttpProvider()
    await expect(p.complete('你好')).rejects.toThrow('未配置')
  })

  it('complete calls the OpenAI-compatible endpoint with config from storage', async () => {
    saveProviderConfig('llm-http', {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
    })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '角色设定内容' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const p = createLLMHttpProvider()
    const text = await p.complete('生成角色设定')
    expect(text).toBe('角色设定内容')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'test-model',
      stream: false,
    })
  })

  it('reads config per call: changing storage takes effect without rebuild', async () => {
    saveProviderConfig('llm-http', {
      baseUrl: 'https://first.example.com/v1',
      apiKey: 'sk-1',
      model: 'm1',
    })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const p = createLLMHttpProvider()
    await p.complete('hi')
    saveProviderConfig('llm-http', {
      baseUrl: 'https://second.example.com/v1',
      apiKey: 'sk-2',
      model: 'm2',
    })
    await p.complete('hi again')

    const secondUrl = fetchMock.mock.calls[1][0] as string
    expect(secondUrl).toContain('second.example.com')
  })

  it('surfaces HTTP errors with status and body', async () => {
    saveProviderConfig('llm-http', {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'm',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid key' }, false, 401)),
    )
    await expect(createLLMHttpProvider().complete('hi')).rejects.toThrow('401')
  })

  it('chat streams SSE delta chunks', async () => {
    saveProviderConfig('llm-http', {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'm',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )
    const p = createLLMHttpProvider()
    let text = ''
    for await (const chunk of p.chat([{ role: 'user', content: '打招呼' }])) text += chunk
    expect(text).toBe('你好，世界')
    const init = (vi.mocked(fetch).mock.calls[0][1] as RequestInit)
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: true })
  })

  it('requires a model name', async () => {
    saveProviderConfig('llm-http', {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    })
    await expect(createLLMHttpProvider().complete('hi')).rejects.toThrow('模型名')
  })
})
