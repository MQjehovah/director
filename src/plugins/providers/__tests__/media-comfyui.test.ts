import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMediaComfyUIProvider, MEDIA_COMFYUI_ID, DEFAULT_TXT2IMG_WORKFLOW } from '../media-comfyui'
import { saveProviderConfig, clearProviderConfig } from '../../../features/settings/httpBackendConfig'
import { saveWorkflowTemplate } from '../../../features/comfyui/workflowStore'

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

/** 最小化 WebSocket 假实现：记录构造 URL，支持测试侧 emit 入站消息 */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []
  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(_data: string): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  emit(type: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type, data }) })
  }
  static reset(): void {
    FakeWebSocket.instances = []
  }
}

function providerWithFakeWs(pollIntervalMs = 1000) {
  return createMediaComfyUIProvider({
    pollIntervalMs,
    wsCtor: FakeWebSocket as unknown as typeof WebSocket,
  })
}

describe('media-comfyui provider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    FakeWebSocket.reset()
    // jsdom 环境没有 WebSocket，但 Node 22 的全局 WebSocket 会泄漏进来；
    // 显式置空以保证默认 wsCtor 走回退分支，避免测试真的去连 127.0.0.1:8188。
    vi.stubGlobal('WebSocket', undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('injects prompt/negative/seed into template nodes when a template is selected', async () => {
    const graphJson = JSON.stringify({
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 42, steps: 20, model: ['4', 0], positive: ['6', 0], negative: ['7', 0] },
      },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder-a', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder-b', clip: ['4', 1] } },
    })
    saveWorkflowTemplate({
      id: 'tpl1',
      name: '节点模板',
      graphJson,
      promptNodeId: '6',
      negativeNodeId: '7',
      seedNodeId: '3',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl1',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'p6' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '一只猫', negativePrompt: '模糊', seed: 777 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(graph['6'].inputs.text).toBe('一只猫')
    expect(graph['7'].inputs.text).toBe('模糊')
    expect(graph['3'].inputs.seed).toBe(777)
    expect(JSON.stringify(graph)).not.toContain('{prompt}')
  })

  it('throws a clear error when the template has no prompt node and no placeholders', async () => {
    saveWorkflowTemplate({
      id: 'tpl2',
      name: '无提示词',
      graphJson: JSON.stringify({
        '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
        '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ai-director', images: ['8', 0] } },
      }),
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl2',
    })
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await expect(p.generateImage({ prompt: 'x' })).rejects.toThrow('工作流缺少提示词节点')
  })

  it('throws a clear error when the selected template does not exist', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'missing-template',
    })
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await expect(p.generateImage({ prompt: 'x' })).rejects.toThrow('模板不存在')
  })

  it('does not let an in-flight poll overwrite a canceled job with done', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    let releaseHistory!: () => void
    const historyPromise = new Promise<Response>((resolve) => {
      releaseHistory = () =>
        resolve(
          jsonResponse({
            p5: {
              status: { completed: true },
              outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
            },
          }),
        )
    })
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith('/prompt')) return Promise.resolve(jsonResponse({ prompt_id: 'p5' }))
      if (String(url).includes('/history/')) return historyPromise
      if (String(url).includes('/view?')) return Promise.resolve(pngResponse())
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    vi.advanceTimersByTime(10)
    await p.cancelJob('p5')
    releaseHistory()
    await flushPromises()
    expect((await p.getJob('p5')).status).toBe('canceled')
  })

  it('updates job progress from websocket progress messages', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt') ? jsonResponse({ prompt_id: 'p10' }) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    const progressSpy = vi.fn()
    p.onJobUpdate((job) => progressSpy(job.progress))
    await p.generateImage({ prompt: 'x' })

    const ws = FakeWebSocket.instances[0]
    expect(ws).toBeDefined()
    ws.emit('progress', { value: 10, max: 20 })
    await flushPromises()
    expect((await p.getJob('p10')).progress).toBe(50)
    expect(progressSpy).toHaveBeenCalledWith(50)
  })

  it('marks a queued job running when websocket progress arrives', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt') ? jsonResponse({ prompt_id: 'p15' }) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    await p.generateImage({ prompt: 'x' })
    expect((await p.getJob('p15')).status).toBe('queued')

    const ws = FakeWebSocket.instances[0]
    ws.emit('progress', { value: 5, max: 20 })
    await flushPromises()
    const job = await p.getJob('p15')
    expect(job.status).toBe('running')
    expect(job.progress).toBe(25)
  })

  it('does not clobber websocket progress when the poller ticks', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt')
          ? jsonResponse({ prompt_id: 'p12' })
          : jsonResponse({ p12: { status: { status_str: 'running', completed: false } } }),
      ),
    )
    const p = providerWithFakeWs(1000)
    await p.generateImage({ prompt: 'x' })
    const ws = FakeWebSocket.instances[0]
    ws.open()

    // WS 报告 75%：修复前轮询会在下一 tick 把它重置为 50
    ws.emit('progress', { value: 15, max: 20 })
    await flushPromises()
    expect((await p.getJob('p12')).progress).toBe(75)

    await vi.advanceTimersByTimeAsync(1000)
    expect((await p.getJob('p12')).progress).toBe(75)
  })

  it('falls back to polling when the WebSocket global is unavailable', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'p11' }))
    const historyCall = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ p11: { status: { status_str: 'running', completed: false } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          p11: {
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
    await p.generateImage({ prompt: 'x' })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const done = await p.getJob('p11')
    expect(done.status).toBe('done')
    expect(done.result?.assetIds).toHaveLength(1)
  })

  it('derives the ws url from the configured http baseUrl', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt') ? jsonResponse({ prompt_id: 'p12' }) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    await p.generateImage({ prompt: 'x' })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toMatch(/^ws:\/\/127\.0\.0\.1:8188\/ws\?clientId=/)
  })

  it('derives a wss url from an https baseUrl', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'https://comfy.example.com:8443' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt') ? jsonResponse({ prompt_id: 'p13' }) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    await p.generateImage({ prompt: 'x' })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toMatch(/^wss:\/\/comfy\.example\.com:8443\/ws\?clientId=/)
  })

  it('reuses a single websocket across generateImage calls', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/prompt') ? jsonResponse({ prompt_id: 'p14' }) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    await p.generateImage({ prompt: 'x' })
    await p.generateImage({ prompt: 'y' })
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('text2video throws a clear error when no video workflow template is configured', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ prompt_id: 'pv1' })))
    const p = providerWithFakeWs()
    await expect(p.generateVideo({ prompt: '奔跑的猫' })).rejects.toThrow('视频工作流模板')
  })

  it('text2video submits the video workflow template', async () => {
    saveWorkflowTemplate({
      id: 'vid-tpl',
      name: '文生视频',
      graphJson: JSON.stringify({
        '5': { class_type: 'KSampler', inputs: { seed: '{seed}' } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'vid-tpl',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pv2' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    const job = await p.generateVideo({ prompt: '奔跑的猫', shotRef: 's1' })
    expect(job.type).toBe('text2video')
    expect(job.shotRef).toBe('s1')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['6'].inputs.text).toBe('奔跑的猫')
  })

  it('image2video injects the input image url into the video template', async () => {
    saveWorkflowTemplate({
      id: 'i2v-tpl',
      name: '图生视频',
      graphJson: JSON.stringify({
        '1': { class_type: 'LoadImage', inputs: { image: '{image}' } },
        '5': { class_type: 'KSampler', inputs: { seed: '{seed}' } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'i2v-tpl',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pv3' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    const job = await p.generateVideo({ imageAssetId: 'data:image/png;base64,AAAA', prompt: '动起来' })
    expect(job.type).toBe('image2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['1'].inputs.image).toBe('data:image/png;base64,AAAA')
    expect(body.prompt['6'].inputs.text).toBe('动起来')
  })

  it('produces a video asset from SaveVideo (gifs) output', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pvid' }))
    const historyCall = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ pvid: { status: { status_str: 'running', completed: false } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          pvid: {
            status: { completed: true },
            outputs: {
              '92': { gifs: [{ filename: 'video/MiniMax_H3_00001_.mp4', subfolder: '', type: 'output' }] },
            },
          },
        }),
      )
    const viewCall = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as Response)
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/prompt')) return promptCall(url, init)
      if (String(url).includes('/history/')) return historyCall(url)
      if (String(url).includes('/view?')) return viewCall(url)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateImage({ prompt: 'x' })
    expect(job.id).toBe('pvid')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const done = await p.getJob('pvid')
    expect(done.status).toBe('done')
    const asset = await p.getAsset(done.result!.assetIds![0])
    expect(asset?.kind).toBe('video')
    expect(asset?.url).toContain('/view?')
    expect(asset?.url).toContain('MiniMax_H3_00001_.mp4')
  })

  it('injects prompt into custom nodes (MiniMax style) and seed into noise_seed', async () => {
    // 无 CLIPTextEncode/KSampler：提示词在自定义节点 prompt 字段，seed 在 RandomNoise.noise_seed
    saveWorkflowTemplate({
      id: 'mm-tpl',
      name: 'MiniMax 图生视频',
      graphJson: JSON.stringify({
        '134': { class_type: 'LoadImage', inputs: { image: '{image}' } },
        '105:15': { class_type: 'RandomNoise', inputs: { noise_seed: 123 } },
        '105:104': {
          class_type: 'MiniMaxH3ImageToVideo',
          inputs: { prompt: '{prompt}', first_frame: ['134', 0] },
        },
      }),
      promptNodeId: '105:104',
      seedNodeId: '105:15',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'mm-tpl',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pv4' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = providerWithFakeWs()
    const job = await p.generateVideo({ imageAssetId: 'data:image/png;base64,BBBB', prompt: '道士说话' })
    expect(job.type).toBe('image2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['105:104'].inputs.prompt).toBe('道士说话')
    expect(body.prompt['105:15'].inputs.noise_seed).not.toBe(123)
    expect(typeof body.prompt['105:15'].inputs.noise_seed).toBe('number')
    expect(body.prompt['134'].inputs.image).toBe('data:image/png;base64,BBBB')
  })
})
