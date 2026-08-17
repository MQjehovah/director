import { AssetSchema, JobSchema } from '../../core/models'
import type { Asset, Job } from '../../core/models'
import type { ProviderPlugin } from '../../core/plugin/types'
import type {
  ImageToVideoParams,
  MediaProvider,
  TextToImageParams,
  TextToVideoParams,
} from '../../providers/MediaProvider'

export interface MediaMockOptions {
  delayMs?: number
  pollIntervalMs?: number
}

export interface MediaMockProvider extends MediaProvider {
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  const jobs = new Map<string, Job>()
  const assets = new Map<string, Asset>()
  const listeners = new Set<(job: Job) => void>()
  let seq = 0

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

  async function waitForJob(id: string, timeoutMs = 5000): Promise<Job> {
    const startedAt = Date.now()
    for (;;) {
      const job = await getJob(id)
      if (job.status !== 'queued' && job.status !== 'running') return job
      if (Date.now() - startedAt > timeoutMs) throw new Error(`waitForJob timed out: ${id}`)
      await sleep(pollIntervalMs)
    }
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
    updateJob(job)
    setTimeout(() => {
      updateJob(JobSchema.parse({ ...job, status: 'done', progress: 100, result: { assetIds: [assetId] } }))
    }, delayMs)
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
    updateJob(job)
    setTimeout(() => {
      updateJob(JobSchema.parse({ ...job, status: 'done', progress: 100, result: { assetIds: [assetId] } }))
    }, delayMs)
    return job
  }

  return {
    id: 'media-mock',
    name: 'Mock 媒体',
    capabilities: { text2image: true, image2video: true, text2video: false, upscale: false },
    generateImage,
    generateVideo,
    getJob,
    onJobUpdate,
    waitForJob,
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
    capabilities: { text2image: true, image2video: true, text2video: false, upscale: false },
    instance,
  }
}
