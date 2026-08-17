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

  const ctrl = createJobController({ pollIntervalMs })
  const assets = new Map<string, Asset>()

  function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-${Date.now().toString(36)}-${seq}`
  }

  async function getAsset(assetId: string): Promise<Asset | undefined> {
    return assets.get(assetId)
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
        ctrl.patchJob(id, { status: 'running', progress: 30 })
        return
      }
      if (status === 'SUCCEEDED') {
        ctrl.stopPoller(id)
        const urls = (data.output.results ?? []).map((r) => r.url).filter(Boolean) as string[]
        if (urls.length === 0) {
          ctrl.fail(id, 'DashScope 成功但未返回图像 URL')
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
        ctrl.patchJob(id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
        return
      }
      // FAILED / CANCELED / UNKNOWN
      ctrl.fail(id, data.output?.results?.[0]?.message ?? data.message ?? status)
    } catch (err) {
      ctrl.fail(id, err instanceof Error ? err.message : String(err))
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
    ctrl.setJob(job)
    ctrl.startPoller(job.id, () => pollTask(job.id), pollIntervalMs)
    return job
  }

  async function generateVideo(_params: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    throw new Error('DashScope 媒体当前仅支持文生图（text2image）。')
  }

  return {
    id: MEDIA_DASHSCOPE_ID,
    name: 'DashScope 文生图',
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
