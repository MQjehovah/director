import { AssetSchema, JobSchema } from '../../core/models'
import type { Asset, Job } from '../../core/models'
import type { ProviderPlugin } from '../../core/plugin/types'
import type {
  ImageToVideoParams,
  MediaProvider,
  TextToImageParams,
  TextToVideoParams,
} from '../../providers/MediaProvider'
import { loadProviderConfig } from '../../features/settings/httpBackendConfig'

export const MEDIA_COMFYUI_ID = 'media-comfyui'

export interface MediaComfyUIOptions {
  pollIntervalMs?: number
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

function readConfig(): { baseUrl: string; workflow: string } {
  const config = loadProviderConfig(MEDIA_COMFYUI_ID) ?? {}
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '')
  const workflow = String(config.workflow ?? '').trim() || DEFAULT_TXT2IMG_WORKFLOW
  if (!baseUrl) {
    throw new Error('ComfyUI 未配置：请在「设置 → ComfyUI 媒体」填写地址（Base URL）。')
  }
  return { baseUrl, workflow }
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
  let seq = 0

  const jobs = new Map<string, Job>()
  const assets = new Map<string, Asset>()
  const listeners = new Set<(job: Job) => void>()
  const pollers = new Map<string, ReturnType<typeof setInterval>>()

  function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-${Date.now().toString(36)}-${seq}`
  }

  function emit(job: Job): void {
    for (const cb of listeners) cb(job)
  }

  function updateJob(job: Job): void {
    jobs.set(job.id, job)
    emit(job)
  }

  async function getJob(id: string): Promise<Job> {
    const job = jobs.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    return job
  }

  function onJobUpdate(cb: (job: Job) => void): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  async function waitForJob(id: string, timeoutMs = 120000): Promise<Job> {
    const startedAt = Date.now()
    for (;;) {
      const job = await getJob(id)
      if (job.status !== 'queued' && job.status !== 'running') return job
      if (Date.now() - startedAt > timeoutMs) throw new Error(`waitForJob timed out: ${id}`)
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
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

  function stopPoll(id: string): void {
    const t = pollers.get(id)
    if (t) clearInterval(t)
    pollers.delete(id)
  }

  async function completeJob(id: string): Promise<void> {
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
        stopPoll(id)
        const job = jobs.get(id)
        if (job) updateJob(JobSchema.parse({ ...job, status: 'failed', progress: 100 }))
        return
      }
      if (!completed || !entry.outputs) return
      const images = Object.values(entry.outputs).flatMap((o) => o.images ?? [])
      if (images.length === 0) {
        stopPoll(id)
        const job = jobs.get(id)
        if (job) updateJob(JobSchema.parse({ ...job, status: 'failed', progress: 100 }))
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
      stopPoll(id)
      const job = jobs.get(id)
      if (job) {
        updateJob(
          JobSchema.parse({ ...job, status: 'done', progress: 100, result: { assetIds: [assetId] } }),
        )
      }
    } catch (err) {
      stopPoll(id)
      const job = jobs.get(id)
      if (job) {
        updateJob(
          JobSchema.parse({
            ...job,
            status: 'failed',
            progress: 100,
            result: { data: { error: err instanceof Error ? err.message : String(err) } },
          }),
        )
      }
    }
  }

  async function generateImage(params: TextToImageParams): Promise<Job> {
    const { baseUrl, workflow } = readConfig()
    const seed = params.seed ?? Math.floor(Math.random() * 1e9)
    const graph = injectPlaceholders(workflow, params.prompt, params.negativePrompt, seed)
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
    updateJob(job)
    const poller = setInterval(() => void completeJob(job.id), pollIntervalMs)
    pollers.set(job.id, poller)
    return job
  }

  async function cancelJob(id: string): Promise<Job> {
    const job = jobs.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    stopPoll(id)
    const canceled = JobSchema.parse({ ...job, status: 'canceled', progress: job.progress })
    updateJob(canceled)
    return canceled
  }

  async function generateVideo(_params: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    throw new Error('ComfyUI 媒体当前仅支持文生图（text2image）。')
  }

  return {
    id: MEDIA_COMFYUI_ID,
    name: 'ComfyUI 媒体',
    capabilities: { text2image: true, image2video: false, text2video: false, upscale: false },
    generateImage,
    generateVideo,
    getJob,
    cancelJob,
    onJobUpdate,
    waitForJob,
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
    description: '调用本地 ComfyUI 工作流生成图片。填写地址与工作流模板（API 格式）后设为当前使用。',
    capabilities: instance.capabilities,
    configFields: ['baseUrl', 'workflow'],
    instance,
  }
}
