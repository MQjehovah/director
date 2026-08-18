import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createMediaComfyUIProvider, MEDIA_COMFYUI_ID, DEFAULT_TXT2IMG_WORKFLOW } from '../media-comfyui'
import { JobSchema } from '../../../core/models'
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

  it('strips MarkdownNote/comment nodes and widgets_values markers before submitting', async () => {
    saveWorkflowTemplate({
      id: 'tpl-strip',
      name: '含注释模板',
      graphJson: JSON.stringify({
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
        '116': { class_type: 'MarkdownNote', inputs: {} },
        '117': { class_type: 'Comment', inputs: {} },
        '118': {
          class_type: 'SomeCustomNode',
          inputs: { prompt: 'x', widgets_values: ['a', 'b'] },
        },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-strip',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pstrip' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '一只猫' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    expect(graph['116']).toBeUndefined()
    expect(graph['117']).toBeUndefined()
    expect(graph['1'].inputs.text).toBe('一只猫')
    expect(graph['118'].inputs.widgets_values).toBeUndefined()
    expect(graph['118'].inputs.prompt).toBe('x')
  })

  it('recovers the switch widget of legacy ComfySwitchNode templates before submitting', async () => {
    saveWorkflowTemplate({
      id: 'tpl-switch',
      name: '旧开关模板',
      graphJson: JSON.stringify({
        '227:226': {
          class_type: 'ComfySwitchNode',
          inputs: {
            on_false: ['227:224', 0],
            on_true: ['227:225', 0],
            widgets_values: [true],
          },
        },
        '227:224': { class_type: 'PrimitiveInt', inputs: { value: 20 } },
        '227:225': { class_type: 'PrimitiveInt', inputs: { value: 4 } },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-switch',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pswitch' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '一只猫' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    expect(graph['227:226'].inputs.switch).toBe(true)
    expect(graph['227:226'].inputs.on_false).toEqual(['227:224', 0])
    expect(graph['227:226'].inputs.on_true).toEqual(['227:225', 0])
    expect(graph['227:226'].inputs.widgets_values).toBeUndefined()
  })

  it('defaults switch to false when an old API-format template lacks it entirely', async () => {
    saveWorkflowTemplate({
      id: 'tpl-switch-default',
      name: '无 switch 旧模板',
      graphJson: JSON.stringify({
        '227:226': {
          class_type: 'ComfySwitchNode',
          inputs: {
            on_false: ['227:224', 0],
            on_true: ['227:225', 0],
          },
        },
        '227:224': { class_type: 'PrimitiveInt', inputs: { value: 20 } },
        '227:225': { class_type: 'PrimitiveInt', inputs: { value: 4 } },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-switch-default',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pswitch2' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '一只猫' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(graph['227:226'].inputs.switch).toBe(false)
    expect(graph['227:226'].inputs.on_false).toEqual(['227:224', 0])
    expect(graph['227:226'].inputs.on_true).toEqual(['227:225', 0])
  })

  it('surfaces node_errors from ComfyUI validation as a readable message', async () => {
    saveWorkflowTemplate({
      id: 'tpl-400',
      name: '校验失败模板',
      graphJson: JSON.stringify({
        '227:226': {
          class_type: 'ComfySwitchNode',
          inputs: { on_false: ['227:224', 0], on_true: ['227:225', 0] },
        },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-400',
    })
    const promptCall = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            type: 'prompt_outputs_failed_validation',
            message: 'Prompt outputs failed validation',
          },
          node_errors: {
            '227:226': {
              errors: [{ type: 'required_input_missing', message: 'Required input is missing: switch' }],
            },
          },
        },
        false,
        400,
      ),
    )
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    let error: Error | undefined
    try {
      await p.generateImage({ prompt: '一只猫' })
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
    }
    expect(error).toBeDefined()
    expect(error!.message).toContain('节点 227:226：Required input is missing: switch')
    // 原始响应必须完整保留，不截断，方便定位故障
    expect(error!.message).toContain('原始响应')
    expect(error!.message).toContain('prompt_outputs_failed_validation')
    expect(error!.message).toContain('Required input is missing: switch')
  })

  it('throws a clear error when the template still contains an unexpanded subgraph UUID node', async () => {
    saveWorkflowTemplate({
      id: 'tpl-uuid',
      name: '未展开子图',
      graphJson: JSON.stringify({
        '227': {
          class_type: '628aea62-54d3-40b8-8b8b-5b648feab266',
          inputs: { prompt: '黄昏' },
        },
      }),
      promptNodeId: '227',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-uuid',
    })
    const fetchMock = vi.fn(() => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await expect(p.generateImage({ prompt: '黄昏' })).rejects.toThrow('未展开的子图节点')
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/prompt'),
      expect.anything(),
    )
  })

  it('repairs stale templates with shifted CLIPLoader values before submitting', async () => {
    saveWorkflowTemplate({
      id: 'tpl-stale',
      name: '旧版参考生视频',
      graphJson: JSON.stringify({
        '227:212': {
          class_type: 'CLIPLoader',
          inputs: { type: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', device: 'minimax' },
        },
        '227:214': {
          class_type: 'VAELoader',
          inputs: { widgets_values: ['minimax_h3_audio_vae_fp32.safetensors'] },
        },
        '227:132': {
          class_type: 'PrimitiveFloat',
          inputs: { widgets_values: [5] },
        },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-stale',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pstale' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '一只猫' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    // 旧版错位自动修复：文件名回到 clip_name，type/device 恢复，缺失值从 widgets_values 恢复
    expect(graph['227:212'].inputs.clip_name).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
    expect(graph['227:212'].inputs.type).toBe('minimax')
    expect(graph['227:212'].inputs.device).toBe('default')
    expect(graph['227:214'].inputs.vae_name).toBe('minimax_h3_audio_vae_fp32.safetensors')
    expect(graph['227:132'].inputs.value).toBe(5)
  })

  it('fills a missing PrimitiveFloat duration from the request when no placeholder exists', async () => {
    saveWorkflowTemplate({
      id: 'tpl-duration',
      name: '时长模板',
      graphJson: JSON.stringify({
        '227:132': { class_type: 'PrimitiveFloat', inputs: {} },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
        '92': { class_type: 'SaveVideo', inputs: { video: ['1', 0] } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      textVideoWorkflowTemplateId: 'tpl-duration',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pdur' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateVideo({ prompt: '奔跑的猫', duration: 8 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['227:132'].inputs.value).toBe(8)
  })

  it('applies provider workflow parameter overrides on every generation', async () => {
    saveWorkflowTemplate({
      id: 'tpl-params',
      name: '参数模板',
      graphJson: JSON.stringify({
        '227:210': {
          class_type: 'ComfySwitchNode',
          inputs: { switch: false, on_false: ['227:211', 0], on_true: ['227:209', 0] },
        },
        '227:209': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'x' } },
        '227:211': { class_type: 'UNETLoader', inputs: { unet_name: 'y' } },
        '227:212': {
          class_type: 'CLIPLoader',
          inputs: { clip_name: 'qwen.safetensors', type: 'minimax', device: 'default' },
        },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
      parameterOverrides: { '227:210:switch': true, '227:212:device': 'cpu' },
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      textVideoWorkflowTemplateId: 'tpl-params',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pparam' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateVideo({ prompt: 'x' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['227:210'].inputs.switch).toBe(true)
    expect(body.prompt['227:212'].inputs.device).toBe('cpu')
    // 未覆盖的参数保持模板默认
    expect(body.prompt['227:212'].inputs.clip_name).toBe('qwen.safetensors')
  })

  it('resolves ${placeholder} parameter overrides from the shot context', async () => {
    saveWorkflowTemplate({
      id: 'tpl-ph',
      name: '占位符模板',
      graphJson: JSON.stringify({
        '227:132': { class_type: 'PrimitiveFloat', inputs: { value: 5 } },
        '227:215': {
          class_type: 'MiniMaxH3ReferenceToVideo',
          inputs: { prompt: '默认', ref_image_size: 'match' },
        },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
      parameterOverrides: {
        '227:132:value': '${duration}',
        '227:215:ref_image_size': '${unknown_placeholder}',
      },
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      textVideoWorkflowTemplateId: 'tpl-ph',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pph' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateVideo({ prompt: 'x', duration: 8 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    // ${duration} 被镜头时长替换并注入
    expect(body.prompt['227:132'].inputs.value).toBe(8)
    // 未识别的占位符不覆盖，保持模板默认
    expect(body.prompt['227:215'].inputs.ref_image_size).toBe('match')
  })

  it('accepts the reference MiniMax H3 API export as a template and submits it intact', async () => {
    // 与用户从应用导出的正确 MiniMax H3 参考生视频 API 图一致（省略 _meta）
    const reference: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
      '92': {
        class_type: 'SaveVideo',
        inputs: {
          filename_prefix: 'video/MiniMax_H3',
          format: 'auto',
          codec: 'auto',
          video: ['227:223', 0],
        },
      },
      '115': {
        class_type: 'ResolutionSelector',
        inputs: { aspect_ratio: '16:9 (Widescreen)', megapixels: 0.4, multiple: 32 },
      },
      '228': {
        class_type: 'LoadImage',
        inputs: { image: 'Qwen-Image-2512_00013_.png [output]' },
      },
      '227:209': {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          lora_name: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
          strength_model: 1,
          model: ['227:211', 0],
        },
      },
      '227:210': {
        class_type: 'ComfySwitchNode',
        inputs: { switch: false, on_false: ['227:211', 0], on_true: ['227:209', 0] },
      },
      '227:211': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'minimax_h3_ref2va_pruned_nvfp4.safetensors', weight_dtype: 'default' },
      },
      '227:212': {
        class_type: 'CLIPLoader',
        inputs: {
          clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
          type: 'minimax',
          device: 'default',
        },
      },
      '227:213': {
        class_type: 'VAELoader',
        inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' },
      },
      '227:214': {
        class_type: 'VAELoader',
        inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' },
      },
      '227:215': {
        class_type: 'MiniMaxH3ReferenceToVideo',
        inputs: {
          prompt: '使用<ref_image_0>作为严格的角色参考',
          width: ['115', 0],
          height: ['115', 1],
          length: ['227:131', 1],
          ref_image_size: 'match',
          clip: ['227:212', 0],
          vae: ['227:213', 0],
          audio_vae: ['227:214', 0],
          'ref_images.ref_image_0': ['228', 0],
        },
      },
      '227:216': {
        class_type: 'RandomNoise',
        inputs: { noise_seed: 642251290792234 },
      },
      '227:217': {
        class_type: 'BasicGuider',
        inputs: { model: ['227:210', 0], conditioning: ['227:215', 0] },
      },
      '227:218': {
        class_type: 'KSamplerSelect',
        inputs: { sampler_name: 'res_multistep' },
      },
      '227:219': {
        class_type: 'BasicScheduler',
        inputs: {
          scheduler: 'simple',
          steps: ['227:226', 0],
          denoise: 1,
          model: ['227:210', 0],
        },
      },
      '227:220': {
        class_type: 'SamplerCustomAdvanced',
        inputs: {
          noise: ['227:216', 0],
          guider: ['227:217', 0],
          sampler: ['227:218', 0],
          sigmas: ['227:219', 0],
          latent_image: ['227:215', 1],
        },
      },
      '227:221': {
        class_type: 'VAEDecode',
        inputs: { samples: ['227:220', 0], vae: ['227:213', 0] },
      },
      '227:222': {
        class_type: 'VAEDecodeAudio',
        inputs: { samples: ['227:220', 0], vae: ['227:214', 0] },
      },
      '227:223': {
        class_type: 'CreateVideo',
        inputs: {
          fps: 24,
          bit_depth: 8,
          images: ['227:221', 0],
          audio: ['227:222', 0],
        },
      },
      '227:224': { class_type: 'PrimitiveInt', inputs: { value: 20 } },
      '227:225': { class_type: 'PrimitiveInt', inputs: { value: 4 } },
      '227:226': {
        class_type: 'ComfySwitchNode',
        inputs: { switch: false, on_false: ['227:224', 0], on_true: ['227:225', 0] },
      },
      '227:131': {
        class_type: 'ComfyMathExpression',
        inputs: {
          expression: 'max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17',
          'values.a': ['227:132', 0],
        },
      },
      '227:132': { class_type: 'PrimitiveFloat', inputs: { value: 5 } },
    }
    saveWorkflowTemplate({
      id: 'tpl-ref',
      name: 'MiniMaxH3参考生视频(正确)',
      graphJson: JSON.stringify(reference),
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      textVideoWorkflowTemplateId: 'tpl-ref',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pref' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateVideo({ prompt: '新的镜头提示词', duration: 5 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    // 完整模板直接提交，不被旧版修复/校验误伤：音频 VAE、时长、CLIP、switch 均保留
    expect(graph['227:214'].inputs.vae_name).toBe('minimax_h3_audio_vae_fp32.safetensors')
    expect(graph['227:213'].inputs.vae_name).toBe('minimax_h3_video_vae_fp16.safetensors')
    expect(graph['227:132'].inputs.value).toBe(5)
    expect(graph['227:212'].inputs.clip_name).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
    expect(graph['227:212'].inputs.type).toBe('minimax')
    expect(graph['227:226'].inputs.switch).toBe(false)
    expect(graph['227:215'].inputs.prompt).toBe('新的镜头提示词')
    expect(typeof graph['227:216'].inputs.noise_seed).toBe('number')
    expect(graph['227:215'].inputs['ref_images.ref_image_0']).toEqual(['228', 0])
  })

  it('reports precisely which critical inputs remain missing in stale templates', async () => {
    saveWorkflowTemplate({
      id: 'tpl-missing',
      name: '缺音频VAE模板',
      graphJson: JSON.stringify({
        '227:214': { class_type: 'VAELoader', inputs: {} },
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-missing',
    })
    const fetchMock = vi.fn(() => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    let error: Error | undefined
    try {
      await p.generateImage({ prompt: 'x' })
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
    }
    expect(error).toBeDefined()
    expect(error!.message).toContain('227:214')
    expect(error!.message).toContain('vae_name')
    expect(error!.message).toContain('原始工作流')
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/prompt'),
      expect.anything(),
    )
  })

  it('injects negative prompt into a custom node negative_prompt field', async () => {
    saveWorkflowTemplate({
      id: 'tpl-custom-neg',
      name: '自定义负向模板',
      graphJson: JSON.stringify({
        '105': {
          class_type: 'MiniMaxH3Subgraph',
          inputs: { prompt: '{prompt}', negative_prompt: '{negative_prompt}', noise_seed: 768 },
        },
      }),
      promptNodeId: '105',
      negativeNodeId: '105',
      seedNodeId: '105',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-custom-neg',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pneg' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '黄昏天台', negativePrompt: '低分辨率，画面模糊', seed: 42 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(graph['105'].inputs.prompt).toBe('黄昏天台')
    expect(graph['105'].inputs.negative_prompt).toBe('低分辨率，画面模糊')
    expect(graph['105'].inputs.noise_seed).toBe(42)
    expect(JSON.stringify(graph)).not.toContain('{negative_prompt}')
  })

  it('injects prompt/negative/seed through primitive refs in an expanded subgraph template', async () => {
    saveWorkflowTemplate({
      id: 'tpl-expanded',
      name: '展开子图模板',
      graphJson: JSON.stringify({
        '238:9': {
          class_type: 'MiniMaxH3TextToVideo',
          inputs: {
            prompt: ['238:7', 0],
            negative_prompt: ['238:70', 0],
            seed: ['238:8', 0],
          },
        },
        '238:7': { class_type: 'PrimitiveString', inputs: { value: '默认提示' } },
        '238:70': { class_type: 'PrimitiveString', inputs: { value: '' } },
        '238:8': { class_type: 'PrimitiveInt', inputs: { value: 0 } },
      }),
      promptNodeId: '238:9',
      negativeNodeId: '238:9',
      seedNodeId: '238:9',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-expanded',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pexp' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '黄昏天台', negativePrompt: '模糊', seed: 42 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    // 值写进 Primitive 节点，生成节点保持引用不变
    expect(graph['238:7'].inputs.value).toBe('黄昏天台')
    expect(graph['238:70'].inputs.value).toBe('模糊')
    expect(graph['238:8'].inputs.value).toBe(42)
    expect(graph['238:9'].inputs.prompt).toEqual(['238:7', 0])
    expect(graph['238:9'].inputs.seed).toEqual(['238:8', 0])
  })

  it('recovers a template with stale/missing node ids by locating prompt/negative/seed in the graph', async () => {
    saveWorkflowTemplate({
      id: 'tpl-stale-ids',
      name: '失效节点ID模板',
      graphJson: JSON.stringify({
        '238:9': {
          class_type: 'MiniMaxH3TextToVideo',
          inputs: {
            prompt: ['238:7', 0],
            negative_prompt: ['238:70', 0],
            seed: ['238:8', 0],
          },
        },
        '238:7': { class_type: 'PrimitiveString', inputs: { value: '默认提示' } },
        '238:70': { class_type: 'PrimitiveString', inputs: { value: '' } },
        '238:8': { class_type: 'PrimitiveInt', inputs: { value: 0 } },
      }),
      // 旧模板：记录的 id 已失效（重新转换后节点 id 变化）
      promptNodeId: 'stale-999',
      negativeNodeId: 'stale-999',
      seedNodeId: 'stale-999',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      workflowTemplateId: 'tpl-stale-ids',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'precover' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: '黄昏天台', negativePrompt: '模糊', seed: 7 })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    expect(graph['238:7'].inputs.value).toBe('黄昏天台')
    expect(graph['238:70'].inputs.value).toBe('模糊')
    expect(graph['238:8'].inputs.value).toBe(7)
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

  it('text2video automatically builds the MiniMax H3 workflow when no template is configured', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pdyn1' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({ prompt: '奔跑的猫', duration: 6 })
    expect(job.type).toBe('text2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['105:104'].class_type).toBe('MiniMaxH3ImageToVideo')
    expect(body.prompt['105:104'].inputs.prompt).toBe('奔跑的猫')
    expect(body.prompt['105:104'].inputs.first_frame).toBeUndefined()
    expect(body.prompt['105:111'].inputs.value).toBe(6)
    expect(typeof body.prompt['105:15'].inputs.noise_seed).toBe('number')
  })

  it('automatically builds a first+last frame MiniMax H3 workflow when no template is configured', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pdyn2' }))
    let uploadCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          uploadCount += 1
          return Promise.resolve(
            jsonResponse({ name: uploadCount === 1 ? 'first.png' : 'last.png' }),
          )
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({
      prompt: '首尾帧动起来',
      imageAssetId: 'data:image/png;base64,AAAA',
      lastFrameAssetId: 'data:image/png;base64,BBBB',
    })
    expect(job.type).toBe('firstLastFrameVideo')
    expect(uploadCount).toBe(2)
    const g = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string).prompt
    expect(g['ai-director-image'].class_type).toBe('LoadImage')
    expect(g['ai-director-image'].inputs.image).toBe('first.png')
    expect(g['105:104'].inputs.first_frame).toEqual(['ai-director-image', 0])
    expect(g['ai-director-last-image'].class_type).toBe('LoadImage')
    expect(g['ai-director-last-image'].inputs.image).toBe('last.png')
    expect(g['105:104'].inputs.last_frame).toEqual(['ai-director-last-image', 0])
  })

  it('wires {last_frame_link} placeholder in the video template to a LoadImage node', async () => {
    saveWorkflowTemplate({
      id: 'fl-frame',
      name: '首尾帧模板',
      graphJson: JSON.stringify({
        '1': {
          class_type: 'MiniMaxH3ImageToVideo',
          inputs: {
            prompt: '{prompt}',
            first_frame: '{image_link}',
            last_frame: '{last_frame_link}',
          },
        },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'fl-frame',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pfl' }))
    let uploadCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          uploadCount += 1
          return Promise.resolve(
            jsonResponse({ name: uploadCount === 1 ? 'first.png' : 'last.png' }),
          )
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({
      prompt: '首尾帧',
      imageAssetId: 'data:image/png;base64,AAAA',
      lastFrameAssetId: 'data:image/png;base64,BBBB',
    })
    expect(job.type).toBe('firstLastFrameVideo')
    expect(uploadCount).toBe(2)
    const g = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string).prompt
    expect(g['1'].inputs.first_frame).toEqual(['ai-director-image', 0])
    expect(g['1'].inputs.last_frame).toEqual(['ai-director-last-image', 0])
    expect(g['ai-director-last-image'].inputs.image).toBe('last.png')
  })

  it('throws a clear error when the template has no tail-frame placeholder', async () => {
    saveWorkflowTemplate({
      id: 'no-tail',
      name: '无尾帧',
      graphJson: JSON.stringify({
        '1': { class_type: 'MiniMaxH3ImageToVideo', inputs: { prompt: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'no-tail',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'first.png' }))
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await expect(
      p.generateVideo({
        prompt: 'x',
        lastFrameAssetId: 'data:image/png;base64,BBBB',
      }),
    ).rejects.toThrow('尾帧')
  })

  it('replaces the {last_frame} value placeholder with the uploaded tail frame filename', async () => {
    saveWorkflowTemplate({
      id: 'tail-value',
      name: '尾帧值',
      graphJson: JSON.stringify({
        '1': {
          class_type: 'LoadImage',
          inputs: { image: '{last_frame}' },
        },
        '2': { class_type: 'KSampler', inputs: { seed: '{seed}' } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '6',
      seedNodeId: '2',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'tail-value',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'ptv' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'tail.png' }))
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({
      prompt: 'x',
      lastFrameAssetId: 'data:image/png;base64,BBBB',
    })
    expect(job.type).toBe('image2video')
    const g = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string).prompt
    expect(g['1'].inputs.image).toBe('tail.png')
  })

  it('automatically builds a video workflow with a LoadImage first frame when no template is configured', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pdyn3' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'frame.png' }))
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({
      imageAssetId: 'data:image/png;base64,AAAA',
      prompt: '动起来',
    })
    expect(job.type).toBe('image2video')
    const g = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string).prompt
    expect(g['ai-director-image'].class_type).toBe('LoadImage')
    expect(g['ai-director-image'].inputs.image).toBe('frame.png')
    expect(g['105:104'].inputs.first_frame).toEqual(['ai-director-image', 0])
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

  it('uses the per-capability video templates for 文生/参考/首尾帧', async () => {
    saveWorkflowTemplate({
      id: 't2v-tpl',
      name: '文生视频模板',
      graphJson: JSON.stringify({
        '1': { class_type: 'T2VNode', inputs: { prompt: '{prompt}' } },
      }),
      promptNodeId: '1',
    })
    saveWorkflowTemplate({
      id: 'i2v-tpl2',
      name: '参考生视频模板',
      graphJson: JSON.stringify({
        '1': {
          class_type: 'I2VNode',
          inputs: { prompt: '{prompt}', first_frame: '{image_link}' },
        },
      }),
      promptNodeId: '1',
    })
    saveWorkflowTemplate({
      id: 'fl2v-tpl',
      name: '首尾帧模板',
      graphJson: JSON.stringify({
        '1': {
          class_type: 'FL2VNode',
          inputs: {
            prompt: '{prompt}',
            first_frame: '{image_link}',
            last_frame: '{last_frame_link}',
          },
        },
      }),
      promptNodeId: '1',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      textVideoWorkflowTemplateId: 't2v-tpl',
      imageVideoWorkflowTemplateId: 'i2v-tpl2',
      firstLastFrameWorkflowTemplateId: 'fl2v-tpl',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pmulti' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'frame.png' }))
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })

    const t2v = await p.generateVideo({ prompt: 'a' })
    expect(t2v.type).toBe('text2video')
    let g = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string).prompt
    expect(g['1'].class_type).toBe('T2VNode')

    const i2v = await p.generateVideo({ prompt: 'b', imageAssetId: 'data:image/png;base64,AAAA' })
    expect(i2v.type).toBe('image2video')
    g = JSON.parse((promptCall.mock.calls[1][1] as RequestInit).body as string).prompt
    expect(g['1'].class_type).toBe('I2VNode')

    const fl2v = await p.generateVideo({
      prompt: 'c',
      imageAssetId: 'data:image/png;base64,AAAA',
      lastFrameAssetId: 'data:image/png;base64,BBBB',
    })
    expect(fl2v.type).toBe('firstLastFrameVideo')
    g = JSON.parse((promptCall.mock.calls[2][1] as RequestInit).body as string).prompt
    expect(g['1'].class_type).toBe('FL2VNode')
    expect(g['1'].inputs.last_frame).toEqual(['ai-director-last-image', 0])
  })

  it('falls back to the legacy 通用视频模板 when per-capability templates are missing', async () => {
    saveWorkflowTemplate({
      id: 'legacy-video',
      name: '通用视频',
      graphJson: JSON.stringify({
        '5': { class_type: 'KSampler', inputs: { seed: '{seed}' } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '6',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'legacy-video',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'plegacy' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({ prompt: 'x' })
    expect(job.type).toBe('text2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['6'].inputs.text).toBe('x')
  })

  it('image2video uploads the input image and injects the uploaded filename', async () => {
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
    const uploadCall = vi
      .fn()
      .mockResolvedValue(jsonResponse({ name: 'ref-up.png', subfolder: '', type: 'input' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) return uploadCall(url, init)
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = providerWithFakeWs()
    const job = await p.generateVideo({ imageAssetId: 'data:image/png;base64,AAAA', prompt: '动起来' })
    expect(job.type).toBe('image2video')
    expect(uploadCall).toHaveBeenCalledTimes(1)
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['1'].inputs.image).toBe('ref-up.png')
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

  it('marks images-with-mp4-filename output as a video asset (new ComfyUI SaveVideo format)', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pvid2' }))
    const historyCall = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ pvid2: { status: { status_str: 'running', completed: false } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          pvid2: {
            status: { completed: true },
            outputs: {
              '92': {
                images: [{ filename: 'MiniMax_H3_00037_.mp4', subfolder: 'video', type: 'output' }],
                animated: [true],
              },
            },
          },
        }),
      )
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/prompt')) return promptCall(url, init)
      if (String(url).includes('/history/')) return historyCall(url)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const done = await p.getJob('pvid2')
    expect(done.status).toBe('done')
    const asset = await p.getAsset(done.result!.assetIds![0])
    expect(asset?.kind).toBe('video')
    expect(asset?.url).toContain('/view?filename=MiniMax_H3_00037_.mp4')
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
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'mm-ref.png' }))
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = providerWithFakeWs()
    const job = await p.generateVideo({ imageAssetId: 'data:image/png;base64,BBBB', prompt: '道士说话' })
    expect(job.type).toBe('image2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['105:104'].inputs.prompt).toBe('道士说话')
    expect(body.prompt['105:15'].inputs.noise_seed).not.toBe(123)
    expect(typeof body.prompt['105:15'].inputs.noise_seed).toBe('number')
    expect(body.prompt['134'].inputs.image).toBe('mm-ref.png')
  })

  it('injects the shot duration into the {duration} placeholder', async () => {
    saveWorkflowTemplate({
      id: 'dur-tpl',
      name: '时长',
      graphJson: JSON.stringify({
        '111': { class_type: 'PrimitiveFloat', inputs: { value: '{duration}' } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '6',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'dur-tpl',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pd1' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({ prompt: 'x', duration: 7 })
    expect(job.type).toBe('text2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['111'].inputs.value).toBe(7)
  })

  it('img2img uploads the reference image and injects the uploaded filename into the workflow', async () => {
    saveWorkflowTemplate({
      id: 'i2i-tpl',
      name: '图生图',
      graphJson: JSON.stringify({
        '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
        '3': { class_type: 'KSampler', inputs: { seed: '{seed}', denoise: 0.6 } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
        '9': {
          class_type: 'SaveImage',
          inputs: { filename_prefix: 'ai-director', images: ['4', 0] },
        },
      }),
      promptNodeId: '6',
      seedNodeId: '3',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      img2imgWorkflowTemplateId: 'i2i-tpl',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pi1' }))
    const uploadCall = vi
      .fn()
      .mockResolvedValue(jsonResponse({ name: 'ref-uploaded.png', subfolder: '', type: 'input' }))
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/upload/image')) return uploadCall(url, init)
      if (String(url).endsWith('/prompt')) return promptCall(url, init)
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      } as unknown as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.editImage({
      imageAssetId: 'https://example.com/ref.png',
      prompt: '屋顶夜景',
    })
    expect(job.type).toBe('editImage')
    expect(uploadCall).toHaveBeenCalledTimes(1)
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    const graph = body.prompt as Record<string, { inputs: Record<string, unknown> }>
    expect(graph['1'].inputs.image).toBe('ref-uploaded.png')
    expect(graph['6'].inputs.text).toBe('屋顶夜景')
  })

  it('img2img replaces the {image} placeholder when the template has one', async () => {
    saveWorkflowTemplate({
      id: 'i2i-ph',
      name: '图生图占位符',
      graphJson: JSON.stringify({
        '1': { class_type: 'LoadImage', inputs: { image: '{image}' } },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '{prompt}' } },
      }),
      promptNodeId: '6',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      img2imgWorkflowTemplateId: 'i2i-ph',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pi2' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'ref2.png' }))
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.editImage({ imageAssetId: 'data:image/jpeg;base64,AAAA', prompt: 'x' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['1'].inputs.image).toBe('ref2.png')
  })

  it('img2img throws a clear error when no img2img workflow template is configured', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({})))
    const p = createMediaComfyUIProvider()
    await expect(
      p.editImage({ imageAssetId: 'data:image/png;base64,AAAA', prompt: 'x' }),
    ).rejects.toThrow('图生图工作流模板')
  })

  it('resumes a running job and polls it to completion after refresh', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188' })
    const historyCall = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ pr: { status: { status_str: 'running', completed: false } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          pr: {
            status: { completed: true },
            outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
          },
        }),
      )
    const viewCall = vi.fn().mockResolvedValue(pngResponse())
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/history/')) return historyCall(url)
        if (String(url).includes('/view?')) return viewCall(url)
        return jsonResponse({})
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const restored = JobSchema.parse({
      id: 'pr',
      type: 'text2image',
      status: 'running',
      progress: 50,
      pluginId: MEDIA_COMFYUI_ID,
    })
    const resumed = await p.resumeJob(restored)
    expect(resumed.id).toBe('pr')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(10)
    const done = await p.getJob('pr')
    expect(done.status).toBe('done')
    expect(done.result?.assetIds).toHaveLength(1)
  })

  it('dynamically inserts a LoadImage node when a first-frame image exists', async () => {
    saveWorkflowTemplate({
      id: 'dyn-img',
      name: '动态首帧',
      graphJson: JSON.stringify({
        '104': {
          class_type: 'MiniMaxH3ImageToVideo',
          inputs: { prompt: '{prompt}', first_frame: '{image_link}' },
        },
      }),
      promptNodeId: '104',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'dyn-img',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pd2' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (String(url).endsWith('/upload/image')) {
          return Promise.resolve(jsonResponse({ name: 'frame.png' }))
        }
        if (String(url).endsWith('/prompt')) return promptCall(url, init)
        return Promise.resolve({
          ok: true,
          status: 200,
          blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
        } as unknown as Response)
      }),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    await p.generateVideo({ imageAssetId: 'data:image/png;base64,AAAA', prompt: 'x' })
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['ai-director-image'].class_type).toBe('LoadImage')
    expect(body.prompt['ai-director-image'].inputs.image).toBe('frame.png')
    expect(body.prompt['104'].inputs.first_frame).toEqual(['ai-director-image', 0])
  })

  it('removes the first-frame link when no image is available', async () => {
    saveWorkflowTemplate({
      id: 'dyn-img-empty',
      name: '动态首帧空',
      graphJson: JSON.stringify({
        '104': {
          class_type: 'MiniMaxH3ImageToVideo',
          inputs: { prompt: '{prompt}', first_frame: '{image_link}' },
        },
      }),
      promptNodeId: '104',
    })
    saveProviderConfig(MEDIA_COMFYUI_ID, {
      baseUrl: 'http://127.0.0.1:8188',
      videoWorkflowTemplateId: 'dyn-img-empty',
    })
    const promptCall = vi.fn().mockResolvedValue(jsonResponse({ prompt_id: 'pd3' }))
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).endsWith('/prompt') ? promptCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaComfyUIProvider({ pollIntervalMs: 10 })
    const job = await p.generateVideo({ prompt: 'x' })
    expect(job.type).toBe('text2video')
    const body = JSON.parse((promptCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.prompt['104'].inputs.first_frame).toBeUndefined()
    expect(body.prompt['ai-director-image']).toBeUndefined()
  })

})
