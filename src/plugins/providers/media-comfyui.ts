import { AssetSchema, JobSchema } from '../../core/models'
import type { Asset, Job } from '../../core/models'
import type { ProviderPlugin } from '../../core/plugin/types'
import type {
  ImageToVideoParams,
  MediaProvider,
  TextToImageParams,
  TextToVideoParams,
} from '../../providers/MediaProvider'
import { createJobController } from '../../providers/capabilities'
import { loadProviderConfig } from '../../features/settings/httpBackendConfig'
import { getWorkflowTemplate } from '../../features/comfyui/workflowStore'
import { usePluginStore } from '../../stores/pluginStore'

export const MEDIA_COMFYUI_ID = 'media-comfyui'

export type WsCtor = typeof WebSocket

export interface MediaComfyUIOptions {
  pollIntervalMs?: number
  wsCtor?: WsCtor
}

/** 默认文生图工作流模板（ComfyUI API 格式），支持 {prompt}/{negative_prompt}/{seed} 占位符 */
export const DEFAULT_TXT2IMG_WORKFLOW = JSON.stringify({
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: '{seed}',
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'model.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 768, height: 768, batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{prompt}', clip: ['4', 1] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{negative_prompt}', clip: ['4', 1] },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'ai-director', images: ['8', 0] },
  },
})

export interface MediaComfyUIProvider extends MediaProvider {
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
  getAsset(assetId: string): Promise<Asset | undefined>
}

interface ComfyHistory {
  [promptId: string]: {
    status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
    outputs?: Record<
      string,
      {
        images?: Array<{ filename: string; subfolder?: string; type?: string }>
        gifs?: Array<{ filename: string; subfolder?: string; type?: string; format?: string }>
      }
    >
  }
}

function readConfig(): { baseUrl: string; workflowTemplateId?: string; videoWorkflowTemplateId?: string } {
  const config = loadProviderConfig(MEDIA_COMFYUI_ID) ?? {}
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error('ComfyUI 未配置：请在「设置 → ComfyUI 媒体」填写地址（Base URL）。')
  }
  const workflowTemplateId =
    typeof config.workflowTemplateId === 'string' && config.workflowTemplateId.trim() !== ''
      ? config.workflowTemplateId.trim()
      : undefined
  const videoWorkflowTemplateId =
    typeof config.videoWorkflowTemplateId === 'string' &&
    config.videoWorkflowTemplateId.trim() !== ''
      ? config.videoWorkflowTemplateId.trim()
      : undefined
  return { baseUrl, workflowTemplateId, videoWorkflowTemplateId }
}

/** 由 HTTP baseUrl 推导 WebSocket 地址：http→ws、https→wss，路径固定为 /ws */
function deriveWsUrl(baseUrl: string, clientId: string): string {
  const url = new URL(baseUrl)
  const protocol = url.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${url.host}/ws?clientId=${clientId}`
}

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** 把占位符注入工作流图（避免文本里含引号破坏 JSON） */
function injectPlaceholders(
  workflowJson: string,
  prompt: string,
  negativePrompt: string | undefined,
  seed: number,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const graph = JSON.parse(workflowJson) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >
  for (const node of Object.values(graph)) {
    for (const key of Object.keys(node.inputs)) {
      const value = node.inputs[key]
      if (value === '{prompt}') node.inputs[key] = prompt
      else if (value === '{negative_prompt}') node.inputs[key] = negativePrompt ?? ''
      else if (value === '{seed}') node.inputs[key] = seed
    }
  }
  return graph
}

interface TemplateNodeIds {
  promptNodeId?: string
  negativeNodeId?: string
  seedNodeId?: string
}

/** 按节点 id 注入 prompt/negative/seed；缺失 prompt 节点时回退到占位符扫描或首个 CLIPTextEncode */
function injectIntoNodes(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
  prompt: string,
  negativePrompt: string | undefined,
  seed: number,
  ids: TemplateNodeIds,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  let promptNodeId = ids.promptNodeId
  let promptInjected = false
  if (promptNodeId) {
    promptInjected = true
  } else {
    for (const node of Object.values(graph)) {
      for (const key of Object.keys(node.inputs)) {
        const value = node.inputs[key]
        if (value === '{prompt}') {
          node.inputs[key] = prompt
          promptInjected = true
        } else if (value === '{negative_prompt}') {
          node.inputs[key] = negativePrompt ?? ''
        } else if (value === '{seed}') {
          node.inputs[key] = seed
        }
      }
    }
    if (!promptInjected) {
      promptNodeId = Object.keys(graph).find((id) =>
        graph[id].class_type.includes('CLIPTextEncode'),
      )
    }
  }

  if (promptNodeId && graph[promptNodeId]) {
    const node = graph[promptNodeId]
    // 自定义节点（如 MiniMaxH3ImageToVideo）用 prompt 字段，CLIPTextEncode 用 text 字段
    if (typeof node.inputs.prompt === 'string') node.inputs.prompt = prompt
    else node.inputs.text = prompt
  } else if (!promptInjected) {
    throw new Error('工作流缺少提示词节点，请重新导入模板或检查模板。')
  }

  if (ids.negativeNodeId && graph[ids.negativeNodeId]) {
    graph[ids.negativeNodeId].inputs.text = negativePrompt ?? ''
  }
  if (ids.seedNodeId && graph[ids.seedNodeId]) {
    const node = graph[ids.seedNodeId]
    if (typeof node.inputs.noise_seed === 'number') node.inputs.noise_seed = seed
    else node.inputs.seed = seed
  }
  return graph
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mov':
      return 'video/quicktime'
    default:
      return 'image/png'
  }
}

export function createMediaComfyUIProvider(opts: MediaComfyUIOptions = {}): MediaComfyUIProvider {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000
  const wsCtor: WsCtor | undefined =
    opts.wsCtor ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
  let seq = 0

  const ctrl = createJobController({ pollIntervalMs })
  const assets = new Map<string, Asset>()

  // ComfyUI 的 progress 事件是全局的（不含 prompt_id）。记录本 provider 已提交的任务 id，
  // 仅当恰好一个任务在跑时把进度上报给它；多个任务并发时跳过，交由粗粒度轮询兜底。
  const activePromptIds = new Set<string>()
  let ws: WebSocket | undefined
  let wsConnected = false
  let wsUnavailable = false

  ctrl.onJobUpdate((job) => {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
      activePromptIds.delete(job.id)
    }
  })

  /** 懒加载并复用单个 WS 连接；无 wsCtor 或连接失败时静默回退到轮询 */
  function ensureWs(baseUrl: string): void {
    if (ws || wsUnavailable || !wsCtor) return
    try {
      ws = new wsCtor(deriveWsUrl(baseUrl, makeClientId()))
    } catch {
      wsUnavailable = true
      return
    }
    ws.onopen = () => {
      wsConnected = true
    }
    ws.onmessage = (event) => {
      let msg: { type?: string; data?: { value?: unknown; max?: unknown } }
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.type !== 'progress') return
      const value = msg.data?.value
      const max = msg.data?.max
      if (typeof value !== 'number' || typeof max !== 'number' || max <= 0) return
      const pct = Math.round((value / max) * 100)
      if (activePromptIds.size !== 1) return
      const id = activePromptIds.values().next().value
      if (typeof id === 'string') ctrl.reportProgress(id, pct)
    }
    ws.onerror = () => {
      wsConnected = false
      ws?.close()
      ws = undefined
    }
    ws.onclose = () => {
      wsConnected = false
      ws = undefined
    }
  }

  function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-${Date.now().toString(36)}-${seq}`
  }

  async function getAsset(assetId: string): Promise<Asset | undefined> {
    return assets.get(assetId)
  }

  /** 解析资产 id → 图片 URL：先查本 provider 生成资产，再回退到存储 Provider（上传图片） */
  async function resolveAssetUrl(assetId: string): Promise<string | undefined> {
    if (assetId.startsWith('data:') || assetId.startsWith('http') || assetId.startsWith('blob:')) {
      return assetId
    }
    const own = assets.get(assetId)
    if (own?.url) return own.url
    if (own?.localPath && !own.localPath.startsWith('idb://')) return own.localPath
    const storage = usePluginStore().storageProvider
    if (storage?.loadAsset) {
      try {
        const asset = await storage.loadAsset(assetId)
        if (asset) return await storage.getAssetUrl(asset)
      } catch {
        // fall through
      }
    }
    return undefined
  }

  async function fetchImage(baseUrl: string, image: { filename: string; subfolder?: string; type?: string }): Promise<{ url: string; mime: string }> {
    const params = new URLSearchParams({ filename: image.filename })
    if (image.subfolder) params.set('subfolder', image.subfolder)
    if (image.type) params.set('type', image.type)
    const res = await fetch(`${baseUrl}/view?${params.toString()}`)
    if (!res.ok) throw new Error(`ComfyUI 取图失败（${res.status}）`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const mime = mimeFor(image.filename)
    return { url: bytesToDataUrl(buf, mime), mime }
  }

  /** 轮询前确认任务未被取消：避免「取消 → 完成」竞态覆盖 canceled 状态 */
  async function pollTask(id: string): Promise<void> {
    const { baseUrl } = readConfig()
    try {
      const res = await fetch(`${baseUrl}/history/${id}`)
      if (!res.ok) throw new Error(`ComfyUI 查询失败（${res.status}）`)
      const history = (await res.json()) as ComfyHistory
      const entry = history[id]
      if (!entry) return
      const status = entry.status?.status_str
      const completed = entry.status?.completed === true
      if (status === 'error') {
        // 终态后 patchJob 会忽略写入，这里用 fail 统一处理（含 stopPoller）
        ctrl.fail(id, 'ComfyUI 执行出错')
        return
      }
      if (!completed || !entry.outputs) {
        // WS 已连接时由 WS 提供实时进度；轮询只确认 running，避免覆盖精细进度
        if (wsConnected) ctrl.patchJob(id, { status: 'running' })
        else ctrl.patchJob(id, { status: 'running', progress: 50 })
        return
      }
      const images = Object.values(entry.outputs).flatMap((o) => o.images ?? [])
      const gifs = Object.values(entry.outputs).flatMap((o) => o.gifs ?? [])
      // 视频输出优先（SaveVideo → gifs）；其次图片
      const video = gifs[0]
      if (video) {
        const assetId = nextId('asset')
        const { url, mime } = await fetchImage(baseUrl, video)
        const asset = AssetSchema.parse({
          id: assetId,
          kind: 'video',
          source: 'ai',
          url,
          metadata: { mime, format: video.format ?? 'mp4' },
        })
        assets.set(assetId, asset)
        ctrl.stopPoller(id)
        ctrl.patchJob(id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
        return
      }
      if (images.length === 0) {
        ctrl.fail(id, 'ComfyUI 未返回图像或视频')
        return
      }
      const assetId = nextId('asset')
      const { url, mime } = await fetchImage(baseUrl, images[0])
      const asset = AssetSchema.parse({
        id: assetId,
        kind: 'image',
        source: 'ai',
        url,
        metadata: { mime },
      })
      assets.set(assetId, asset)
      ctrl.stopPoller(id)
      ctrl.patchJob(id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
    } catch (err) {
      ctrl.fail(id, err instanceof Error ? err.message : String(err))
    }
  }

  /** 提交工作流到 /prompt 并注册任务轮询；返回已注册的 Job */
  async function submitWorkflow(
    graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
    type: string,
    shotRef: string | undefined,
    seed: number,
  ): Promise<Job> {
    const { baseUrl } = readConfig()
    const res = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`ComfyUI 提交失败（${res.status}）：${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as { prompt_id?: string }
    const promptId = data.prompt_id
    if (!promptId) throw new Error('ComfyUI 未返回 prompt_id')
    const job = JobSchema.parse({
      id: promptId,
      type,
      status: 'queued',
      progress: 0,
      shotRef,
      pluginId: MEDIA_COMFYUI_ID,
      params: { seed },
    })
    ctrl.setJob(job)
    activePromptIds.add(job.id)
    ctrl.startPoller(job.id, () => pollTask(job.id), pollIntervalMs)
    return job
  }

  /** 解析工作流模板：按 id 加载并注入提示词/seed/输入图 */
  function buildGraph(
    templateId: string | undefined,
    prompt: string,
    negativePrompt: string | undefined,
    seed: number,
    inputImageUrl?: string,
  ): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
    if (templateId) {
      const template = getWorkflowTemplate(templateId)
      if (!template) {
        throw new Error('ComfyUI 工作流模板不存在，请在「设置」中重新选择或导入模板。')
      }
      const graph = JSON.parse(template.graphJson) as Record<
        string,
        { class_type: string; inputs: Record<string, unknown> }
      >
      const injected = injectIntoNodes(graph, prompt, negativePrompt, seed, {
        promptNodeId: template.promptNodeId,
        negativeNodeId: template.negativeNodeId,
        seedNodeId: template.seedNodeId,
      })
      if (inputImageUrl) {
        // 把 {image} 占位符替换为输入图 URL；无占位符则尝试写 LoadImage 节点
        let replaced = false
        for (const node of Object.values(injected)) {
          for (const key of Object.keys(node.inputs)) {
            if (node.inputs[key] === '{image}') {
              node.inputs[key] = inputImageUrl
              replaced = true
            }
          }
        }
        if (!replaced) {
          const loadImageId = Object.keys(injected).find(
            (id) => injected[id].class_type === 'LoadImage',
          )
          if (loadImageId && injected[loadImageId].inputs) {
            injected[loadImageId].inputs.image = inputImageUrl
          }
        }
      }
      return injected
    }
    // 无模板：图片用内置文生图模板；视频明确报错
    if (inputImageUrl) {
      throw new Error('图生视频需要在 ComfyUI 工作流模板中配置 {image} 占位符或 LoadImage 节点。')
    }
    return injectPlaceholders(DEFAULT_TXT2IMG_WORKFLOW, prompt, negativePrompt, seed)
  }

  async function generateImage(params: TextToImageParams): Promise<Job> {
    const { baseUrl, workflowTemplateId } = readConfig()
    ensureWs(baseUrl)
    const seed = params.seed ?? Math.floor(Math.random() * 1e9)
    const graph = buildGraph(workflowTemplateId, params.prompt, params.negativePrompt, seed)
    return submitWorkflow(graph, 'text2image', params.shotRef, seed)
  }

  async function generateVideo(params: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    const { baseUrl, videoWorkflowTemplateId } = readConfig()
    ensureWs(baseUrl)
    const seed = Math.floor(Math.random() * 1e9)
    const imageAssetId = 'imageAssetId' in params ? params.imageAssetId : undefined
    if (imageAssetId) {
      const inputUrl = await resolveAssetUrl(imageAssetId)
      if (!inputUrl) {
        throw new Error('无法解析输入图，请先生成或上传该镜头的首帧图。')
      }
      const graph = buildGraph(
        videoWorkflowTemplateId,
        params.prompt ?? '',
        undefined,
        seed,
        inputUrl,
      )
      return submitWorkflow(graph, 'image2video', params.shotRef, seed)
    }
    if (!videoWorkflowTemplateId) {
      throw new Error(
        '未配置视频工作流模板：请在「设置 → ComfyUI 媒体」的视频工作流模板中导入并选择文生视频/图生视频工作流。',
      )
    }
    const graph = buildGraph(videoWorkflowTemplateId, params.prompt ?? '', undefined, seed)
    return submitWorkflow(graph, 'text2video', params.shotRef, seed)
  }

  return {
    id: MEDIA_COMFYUI_ID,
    name: 'ComfyUI 媒体',
    capabilities: ['text2image', 'text2video', 'image2video'],
    generateImage,
    generateVideo,
    getJob: ctrl.getJob,
    cancelJob: ctrl.cancelJob,
    onJobUpdate: ctrl.onJobUpdate,
    waitForJob: ctrl.waitForJob,
    getAsset,
  }
}

export function createMediaComfyUIPlugin(opts?: MediaComfyUIOptions): ProviderPlugin<MediaProvider> {
  const instance = createMediaComfyUIProvider(opts)
  return {
    id: MEDIA_COMFYUI_ID,
    name: 'ComfyUI 媒体',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    description:
      '调用本地 ComfyUI 工作流生成图片与视频。可在「设置 → ComfyUI 工作流模板」导入 API 格式模板；「文生图模板」用于图片，「视频工作流模板」用于文生视频/图生视频。',
    capabilities: instance.capabilities,
    configFields: ['baseUrl', 'workflowTemplateId', 'videoWorkflowTemplateId'],
    instance,
  }
}
