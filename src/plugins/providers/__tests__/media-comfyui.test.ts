import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMediaComfyUIProvider, MEDIA_COMFYUI_ID, DEFAULT_TXT2IMG_WORKFLOW } from '../media-comfyui'
import { saveProviderConfig, clearProviderConfig } from '../../../features/settings/httpBackendConfig'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

function pngResponse(): Response {
  // 1x1 红色 PNG 的最小字节
  const bytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 252, 255, 255, 63, 0, 5, 0, 1, 254, 255, 255, 122, 17, 199, 134, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer as ArrayBuffer } as unknown as Response
}

describe('media-comfyui provider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clearProviderConfig(MEDIA_COMFYUI_ID)
  })

  it('throws a clear error when baseUrl is missing', async () => {
    const p = createMediaComfyUIProvider()
    await expect(p.generateImage({ prompt: '一只猫' })).rejects.toThrow('未配置')
  })

  it('submits the workflow with injected prompt and completes via polling', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'p1' }))
    const historyCall = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ p1: { status: { status_str: 'running', completed: false } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          p1: {
            status: { completed: true },
            outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
          },
        }),
      )
    const viewCall = vi.fn().mockResolvedValue(pngResponse())
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/prompt')) return promptCall(url, init)
      if (String(url).includes('/history/')) return historyCall(url)
      if (String(url).includes('/view?')) return viewCall(url)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateImage({ prompt: '一只银发剑士', negativePrompt: '模糊' })
    expect(job.id).toBe('p1')
    expect(job.status).toBe('queued')

    // 校验注入 prompt 的工作流
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(graph['6'].inputs.text).toBe('一只银发剑士')
    expect(graph['7'].inputs.text).toBe('模糊')
    expect(typeof graph['3'].inputs.seed).toBe('number')

    await vi.advanceTimersByTimeAsync(10)
    expect(historyCall).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    const done = await p.getJob('p1')
    expect(done.status).toBe('done')
    expect(done.result?.assetIds).toHaveLength(1)

    const asset = await p.getAsset(done.result!.assetIds![0])
    expect(asset?.kind).toBe('image')
    expect(asset?.url).toContain('data:image/png;base64,')
  })

  it('marks the job failed when history reports an error', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt')
          ? jsonResponse({ prompt_id: 'p2' })
          : jsonResponse({ p2: { status: { status_str: 'error' } } }),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    await vi.advanceTimersByTimeAsync(10)
    expect((await p.getJob('p2')).status).toBe('failed')
  })

  it('reuses the default workflow template when config has none', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const fetchMock = vi.fn((url: string, _init?: RequestInit) =>
      String(url).endsWith('/prompt') ? jsonResponse({ prompt_id: 'p3' }) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    const graph = body.prompt as Record<string, { class_type: string }>
    expect(graph['9'].class_type).toBe('SaveImage')
    expect(DEFAULT_TXT2IMG_WORKFLOW).toContain('{prompt}')
  })

  it('cancelJob stops the poller and marks canceled', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ prompt_id: 'p4' })))
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    const canceled = await p.cancelJob('p4')
    expect(canceled.status).toBe('canceled')
    const before = vi.mocked(fetch).mock.calls.length
    await vi.advanceTimersByTimeAsync(50)
    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
  })
})
