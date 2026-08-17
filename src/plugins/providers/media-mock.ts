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

export interface MediaMockOptions {
  delayMs?: number
  pollIntervalMs?: number
}

export interface MediaMockProvider extends MediaProvider {
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
  getAsset(assetId: string): Promise<Asset | undefined>
}

function placeholderSvgUrl(label: string, width: number, height: number): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#e2e8f0"/>`,
    `<text x="50%" y="50%" font-family="system-ui, sans-serif" font-size="18" fill="#475569" text-anchor="middle" dominant-baseline="middle">${label}</text>`,
    `</svg>`,
  ].join('')
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function createMediaMockProvider(opts: MediaMockOptions = {}): MediaMockProvider {
  const delayMs = opts.delayMs ?? 250
  const pollIntervalMs = opts.pollIntervalMs ?? 25

  const ctrl = createJobController({ pollIntervalMs })
  const assets = new Map<string, Asset>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let seq = 0

  function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-${Date.now().toString(36)}-${seq}`
  }

  async function getAsset(assetId: string): Promise<Asset | undefined> {
    return assets.get(assetId)
  }

  async function waitForJob(id: string, timeoutMs = 5000): Promise<Job> {
    return ctrl.waitForJob(id, timeoutMs)
  }

  async function cancelJob(id: string): Promise<Job> {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    return ctrl.cancelJob(id)
  }

  function scheduleCompletion(job: Job, assetId: string): void {
    const timer = setTimeout(() => {
      timers.delete(job.id)
      ctrl.patchJob(job.id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
    }, delayMs)
    timers.set(job.id, timer)
  }

  async function generateImage(params: TextToImageParams): Promise<Job> {
    const width = params.width ?? 512
    const height = params.height ?? 512
    const assetId = nextId('asset')
    const asset = AssetSchema.parse({
      id: assetId,
      kind: 'image',
      source: 'ai',
      url: placeholderSvgUrl(params.prompt || 'image', width, height),
      metadata: { prompt: params.prompt, width, height, seed: params.seed },
    })
    assets.set(assetId, asset)
    const job = JobSchema.parse({
      id: nextId('job'),
      type: 'text2image',
      status: 'running',
      progress: 5,
      shotRef: params.shotRef,
      params: { prompt: params.prompt, negativePrompt: params.negativePrompt, width, height, seed: params.seed },
      pluginId: 'media-mock',
    })
    ctrl.setJob(job)
    scheduleCompletion(job, assetId)
    return job
  }

  async function generateVideo(params: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    const isImage2Video = 'imageAssetId' in params
    const type = isImage2Video ? 'image2video' : 'text2video'
    const assetId = nextId('asset')
    const asset = AssetSchema.parse({
      id: assetId,
      kind: 'video',
      source: 'ai',
      url: placeholderSvgUrl(params.prompt || type, 512, 512),
      metadata: { prompt: params.prompt, type },
    })
    assets.set(assetId, asset)
    const job = JobSchema.parse({
      id: nextId('job'),
      type,
      status: 'running',
      progress: 5,
      shotRef: params.shotRef,
      params: { ...params },
      pluginId: 'media-mock',
    })
    ctrl.setJob(job)
    scheduleCompletion(job, assetId)
    return job
  }

  return {
    id: 'media-mock',
    name: 'Mock 媒体',
    capabilities: ['text2image', 'image2video', 'text2video'],
    generateImage,
    generateVideo,
    getJob: ctrl.getJob,
    cancelJob,
    onJobUpdate: ctrl.onJobUpdate,
    waitForJob,
    getAsset,
  }
}

export function createMediaMockPlugin(opts?: MediaMockOptions): ProviderPlugin<MediaProvider> {
  const instance = createMediaMockProvider(opts)
  return {
    id: 'media-mock',
    name: 'Mock 媒体',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    capabilities: instance.capabilities,
    instance,
  }
}
