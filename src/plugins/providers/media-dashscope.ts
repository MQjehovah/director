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

export const MEDIA_DASHSCOPE_ID = 'media-dashscope'

export interface MediaDashScopeOptions {
  pollIntervalMs?: number
}

/** 默认创建任务地址（用户可覆盖，如换成业务空间专属域名） */
export const DEFAULT_DASHSCOPE_TEXT2IMAGE_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis'

export interface MediaDashScopeProvider extends MediaProvider {
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
  getAsset(assetId: string): Promise<Asset | undefined>
}

interface TaskOutput {
  output: {
    task_id: string
    task_status: string
    results?: Array<{ url?: string; code?: string; message?: string }>
  }
  code?: string
  message?: string
}

function readConfig(): { baseUrl: string; apiKey: string; model: string } {
  const config = loadProviderConfig(MEDIA_DASHSCOPE_ID) ?? {}
  const baseUrl = String(config.baseUrl ?? '').trim() || DEFAULT_DASHSCOPE_TEXT2IMAGE_URL
  const apiKey = String(config.apiKey ?? '').trim()
  const model = String(config.model ?? '').trim() || 'wanx-v1'
  if (!apiKey) {
    throw new Error('DashScope 未配置：请在「设置 → DashScope 媒体」填写 API Key。')
  }
  return { baseUrl, apiKey, model }
}

export function createMediaDashScopeProvider(opts: MediaDashScopeOptions = {}): MediaDashScopeProvider {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000
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

  function stopPoll(id: string): void {
    const t = pollers.get(id)
    if (t) clearInterval(t)
    pollers.delete(id)
  }

  /** 任务查询端点：从创建任务的 URL 推导 /api/v1/tasks/{id} */
  function taskUrl(baseUrl: string, id: string): string {
    const match = /^(https?:\/\/[^/]+)\/(api\/v\d+)/.exec(baseUrl)
    if (match) return `${match[1]}/${match[2]}/tasks/${id}`
    return `${baseUrl.replace(/\/$/, '')}/tasks/${id}`
  }

  async function pollTask(id: string): Promise<void> {
    const { apiKey, baseUrl } = readConfig()
    try {
      const res = await fetch(taskUrl(baseUrl, id), {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`DashScope 查询失败（${res.status}）：${text.slice(0, 200)}`)
      }
      const data = (await res.json()) as TaskOutput
      const status = data.output?.task_status
      if (!status) throw new Error('DashScope 返回缺少 task_status')
      if (status === 'PENDING' || status === 'RUNNING') {
        const job = jobs.get(id)
        if (job) updateJob(JobSchema.parse({ ...job, status: 'running', progress: 30 }))
        return
      }
      stopPoll(id)
      if (status === 'SUCCEEDED') {
        const urls = (data.output.results ?? []).map((r) => r.url).filter(Boolean) as string[]
        if (urls.length === 0) {
          const job = jobs.get(id)
          if (job) updateJob(JobSchema.parse({ ...job, status: 'failed', progress: 100 }))
          return
        }
        const assetId = nextId('asset')
        const asset = AssetSchema.parse({
          id: assetId,
          kind: 'image',
          source: 'ai',
          url: urls[0],
        })
        assets.set(assetId, asset)
        const job = jobs.get(id)
        if (job) {
          updateJob(
            JobSchema.parse({ ...job, status: 'done', progress: 100, result: { assetIds: [assetId] } }),
          )
        }
        return
      }
      // FAILED / CANCELED / UNKNOWN
      const job = jobs.get(id)
      if (job) {
        updateJob(
          JobSchema.parse({
            ...job,
            status: 'failed',
            progress: 100,
            result: {
              data: {
                error: data.output?.results?.[0]?.message ?? data.message ?? status,
              },
            },
          }),
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
    const { baseUrl, apiKey, model } = readConfig()
    const size = params.width && params.height ? `${params.width}*${params.height}` : undefined
    const body: Record<string, unknown> = {
      model,
      input: { prompt: params.prompt },
      parameters: { n: 1 },
    }
    if (params.negativePrompt) body.input = { ...(body.input as object), negative_prompt: params.negativePrompt }
    if (size) (body.parameters as Record<string, unknown>).size = size
    if (params.seed !== undefined) (body.parameters as Record<string, unknown>).seed = params.seed

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`DashScope 建任务失败（${res.status}）：${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as TaskOutput
    const taskId = data.output?.task_id
    if (!taskId) throw new Error(`DashScope 未返回 task_id：${data.message ?? ''}`)

    const job = JobSchema.parse({
      id: taskId,
      type: 'text2image',
      status: 'queued',
      progress: 0,
      shotRef: params.shotRef,
      pluginId: MEDIA_DASHSCOPE_ID,
      params: { prompt: params.prompt, negativePrompt: params.negativePrompt, model },
    })
    updateJob(job)
    const poller = setInterval(() => void pollTask(job.id), pollIntervalMs)
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
    throw new Error('DashScope 媒体当前仅支持文生图（text2image）。')
  }

  return {
    id: MEDIA_DASHSCOPE_ID,
    name: 'DashScope 文生图',
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

export function createMediaDashScopePlugin(opts?: MediaDashScopeOptions): ProviderPlugin<MediaProvider> {
  const instance = createMediaDashScopeProvider(opts)
  return {
    id: MEDIA_DASHSCOPE_ID,
    name: 'DashScope 文生图',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    description: '通义万相/阿里云百炼文生图。填写 API Key（与模型名），设为当前使用后生成立绘走 DashScope。',
    capabilities: instance.capabilities,
    configFields: ['baseUrl', 'apiKey', 'model'],
    instance,
  }
}
