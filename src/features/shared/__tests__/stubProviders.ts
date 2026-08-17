import { AssetSchema, JobSchema } from '../../../core/models'
import type { Asset, Job } from '../../../core/models'
import type { ProviderPlugin } from '../../../core/plugin/types'
import { createJobController } from '../../../providers/capabilities/shared'
import type {
  ImageToVideoParams,
  TextToImageParams,
  TextToVideoParams,
} from '../../../providers/capabilities'
import type { LLMProvider } from '../../../providers/LLMProvider'
import type { TTSProvider } from '../../../providers/TTSProvider'

function placeholderSvgUrl(label: string): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`,
    `<rect width="100%" height="100%" fill="#e2e8f0"/>`,
    `<text x="50%" y="50%" font-family="sans-serif" font-size="10" fill="#475569" text-anchor="middle" dominant-baseline="middle">${label}</text>`,
    `</svg>`,
  ].join('')
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 测试用内存媒体 Provider：立即完成并生成占位图资产 */
export function createStubMediaProvider(opts: { delayMs?: number } = {}): {
  id: string
  name: string
  capabilities: string[]
  generateImage: (p: TextToImageParams) => Promise<Job>
  generateVideo: (p: ImageToVideoParams | TextToVideoParams) => Promise<Job>
  getJob: (id: string) => Promise<Job>
  onJobUpdate: (cb: (job: Job) => void) => () => void
  cancelJob: (id: string) => Promise<Job>
  getAsset: (id: string) => Promise<Asset | undefined>
} {
  const delayMs = opts.delayMs ?? 0
  const ctrl = createJobController({ pollIntervalMs: 10 })
  const assets = new Map<string, Asset>()
  let seq = 0

  function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-${Date.now().toString(36)}-${seq}`
  }

  async function generateImage(p: TextToImageParams): Promise<Job> {
    const assetId = nextId('asset')
    const asset = AssetSchema.parse({
      id: assetId,
      kind: 'image',
      source: 'ai',
      url: placeholderSvgUrl(p.prompt?.slice(0, 8) || 'img'),
    })
    assets.set(assetId, asset)
    const job = JobSchema.parse({
      id: nextId('job'),
      type: 'text2image',
      status: 'running',
      progress: 5,
      shotRef: p.shotRef,
      pluginId: 'stub-media',
      params: { prompt: p.prompt },
    })
    ctrl.setJob(job)
    setTimeout(() => {
      ctrl.patchJob(job.id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
    }, delayMs)
    return job
  }

  async function generateVideo(p: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    const isImage2Video = 'imageAssetId' in p && Boolean(p.imageAssetId)
    const type = isImage2Video ? 'image2video' : 'text2video'
    const assetId = nextId('asset')
    const asset = AssetSchema.parse({
      id: assetId,
      kind: 'video',
      source: 'ai',
      url: placeholderSvgUrl(p.prompt?.slice(0, 8) || 'vid'),
    })
    assets.set(assetId, asset)
    const job = JobSchema.parse({
      id: nextId('job'),
      type,
      status: 'running',
      progress: 5,
      shotRef: p.shotRef,
      pluginId: 'stub-media',
      params: {
        prompt: p.prompt,
        ...(isImage2Video ? { imageAssetId: (p as ImageToVideoParams).imageAssetId } : {}),
      },
    })
    ctrl.setJob(job)
    setTimeout(() => {
      ctrl.patchJob(job.id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
    }, delayMs)
    return job
  }

  return {
    id: 'stub-media',
    name: 'Stub 媒体',
    capabilities: ['text2image', 'image2video', 'text2video'],
    generateImage,
    generateVideo,
    getJob: ctrl.getJob,
    onJobUpdate: ctrl.onJobUpdate,
    cancelJob: ctrl.cancelJob,
    getAsset: async (id) => assets.get(id),
  }
}

export function createStubMediaPlugin(opts?: { delayMs?: number }): ProviderPlugin {
  const instance = createStubMediaProvider(opts)
  return {
    id: 'stub-media',
    name: 'Stub 媒体',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    capabilities: instance.capabilities as never,
    instance,
  }
}

/** 测试用内存 LLM Provider：返回「Mock 回复」+ 输入原文 */
export function createStubLLMProvider(): LLMProvider {
  return {
    id: 'stub-llm',
    name: 'Stub LLM',
    models: [{ id: 'stub-chat', name: 'Stub Chat' }],
    async *chat(messages) {
      yield `Mock 回复：${messages.map((m) => m.content).join(' ')}`
    },
    async complete(prompt: string) {
      return `Mock 回复：${prompt}`
    },
  }
}

export function createStubLLMPlugin(): ProviderPlugin {
  return {
    id: 'stub-llm',
    name: 'Stub LLM',
    kind: 'provider',
    providerType: 'llm',
    enabled: true,
    instance: createStubLLMProvider(),
  }
}

/** 测试用内存 TTS Provider：立即完成配音 */
export function createStubTTSProvider(): TTSProvider {
  const ctrl = createJobController({ pollIntervalMs: 10 })
  let seq = 0
  return {
    id: 'stub-tts',
    name: 'Stub TTS',
    voices: [{ id: 'v1', name: '晓梅', gender: 'female' }],
    async synthesize(text: string) {
      seq += 1
      const job = JobSchema.parse({
        id: `tts-job-${seq}`,
        type: 'tts',
        status: 'running',
        progress: 10,
        pluginId: 'stub-tts',
        params: { text },
      })
      ctrl.setJob(job)
      setTimeout(() => {
        ctrl.patchJob(job.id, {
          status: 'done',
          progress: 100,
          result: { assetIds: [`tts-asset-${seq}`] },
        })
      }, 0)
      return job
    },
    getJob: ctrl.getJob,
    cancelJob: ctrl.cancelJob,
    onJobUpdate: ctrl.onJobUpdate,
  }
}

export function createStubTTSPlugin(): ProviderPlugin {
  return {
    id: 'stub-tts',
    name: 'Stub TTS',
    kind: 'provider',
    providerType: 'tts',
    enabled: true,
    instance: createStubTTSProvider(),
  }
}
