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
    outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>
  }
}

function readConfig(): { baseUrl: string; workflowTemplateId?: string } {
  const config = loadProviderConfig(MEDIA_COMFYUI_ID) ?? {}
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error('ComfyUI 未配置：请在「设置 → ComfyUI 媒体」填写地址（Base URL）。')
  }
  const workflowTemplateId =
    typeof config.workflowTemplateId === 'string' && config.workflowTemplateId.trim() !== ''
      ? config.workflowTemplateId.trim()
      : undefined
  return { baseUrl, workflowTemplateId }
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
  if (!promptNodeId) {
    let placeholderFound = false
    for (const node of Object.values(graph)) {
      for (const key of Object.keys(node.inputs)) {
        const value = node.inputs[key]
        if (value === '{prompt}') {
          node.inputs[key] = prompt
          placeholderFound = true
        } else if (value === '{negative_prompt}') {
          node.inputs[key] = negativePrompt ?? ''
        } else if (value === '{seed}') {
          node.inputs[key] = seed
        }
      }
    }
    if (!placeholderFound) {
      promptNodeId = Object.keys(graph).find((id) =>
        graph[id].class_type.includes('CLIPTextEncode'),
      )
    }
  }

  if (promptNodeId && graph[promptNodeId]) {
    graph[promptNodeId].inputs.text = prompt
  } else {
    throw new Error('工作流缺少提示词节点，请重新导入模板或检查模板。')
  }

  if (ids.negativeNodeId && graph[ids.negativeNodeId]) {
    graph[ids.negativeNodeId].inputs.text = negativePrompt ?? ''
  }
  if (ids.seedNodeId && graph[ids.seedNodeId]) {
    graph[ids.seedNodeId].inputs.seed = seed
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
      ws?.close()
      ws = undefined
    }
    ws.onclose = () => {
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
        ctrl.patchJob(id, { status: 'running', progress: 50 })
        return
      }
      const images = Object.values(entry.outputs).flatMap((o) => o.images ?? [])
      if (images.length === 0) {
        ctrl.fail(id, 'ComfyUI 未返回图像')
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

  async function generateImage(params: TextToImageParams): Promise<Job> {
    const { baseUrl, workflowTemplateId } = readConfig()
    ensureWs(baseUrl)
    const seed = params.seed ?? Math.floor(Math.random() * 1e9)
    let graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>
    if (workflowTemplateId) {
      const template = getWorkflowTemplate(workflowTemplateId)
      if (!template) {
        throw new Error('ComfyUI 工作流模板不存在，请在「设置」中重新选择或导入模板。')
      }
      graph = JSON.parse(template.graphJson) as Record<
        string,
        { class_type: string; inputs: Record<string, unknown> }
      >
      graph = injectIntoNodes(graph, params.prompt, params.negativePrompt, seed, {
        promptNodeId: template.promptNodeId,
        negativeNodeId: template.negativeNodeId,
        seedNodeId: template.seedNodeId,
      })
    } else {
      graph = injectPlaceholders(DEFAULT_TXT2IMG_WORKFLOW, params.prompt, params.negativePrompt, seed)
    }
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
      type: 'text2image',
      status: 'queued',
      progress: 0,
      shotRef: params.shotRef,
      pluginId: MEDIA_COMFYUI_ID,
      params: { prompt: params.prompt, negativePrompt: params.negativePrompt, seed },
    })
    ctrl.setJob(job)
    activePromptIds.add(job.id)
    ctrl.startPoller(job.id, () => pollTask(job.id), pollIntervalMs)
    return job
  }

  async function generateVideo(_params: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    throw new Error('ComfyUI 媒体当前仅支持文生图（text2image）。')
  }

  return {
    id: MEDIA_COMFYUI_ID,
    name: 'ComfyUI 媒体',
    capabilities: ['text2image'],
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
      '调用本地 ComfyUI 工作流生成图片。可在「设置 → ComfyUI 工作流模板」导入并管理 API 格式模板，选择模板后自动注入提示词与 seed。',
    capabilities: instance.capabilities,
    configFields: ['baseUrl', 'workflowTemplateId'],
    instance,
  }
}
