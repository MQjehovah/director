import { AssetSchema, JobSchema } from '../../core/models'
import type { Asset, Job } from '../../core/models'
import type { ProviderPlugin } from '../../core/plugin/types'
import type { TTSProvider } from '../../providers/TTSProvider'

export interface TTSSyncMockOptions {
  delayMs?: number
}

export interface TTSSyncMock extends TTSProvider {
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
  getAsset(assetId: string): Promise<Asset | undefined>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function placeholderAudioUrl(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const binary = String.fromCharCode(...bytes)
  return `data:audio/mp3;base64,${btoa(binary)}`
}

export function createTTSSyncMock(opts: TTSSyncMockOptions = {}): TTSSyncMock {
  const delayMs = opts.delayMs ?? 200

  const jobs = new Map<string, Job>()
  const assets = new Map<string, Asset>()
  const listeners = new Set<(job: Job) => void>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
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
      await sleep(25)
    }
  }

  async function getAsset(assetId: string): Promise<Asset | undefined> {
    return assets.get(assetId)
  }

  async function cancelJob(id: string): Promise<Job> {
    const job = jobs.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    const canceled = JobSchema.parse({ ...job, status: 'canceled', progress: job.progress })
    updateJob(canceled)
    return canceled
  }

  async function synthesize(text: string, voiceId?: string): Promise<Job> {
    const assetId = nextId('tts-asset')
    const asset = AssetSchema.parse({
      id: assetId,
      kind: 'audio',
      source: 'generated',
      url: placeholderAudioUrl(text),
      metadata: { text, voiceId },
    })
    assets.set(assetId, asset)
    const job = JobSchema.parse({
      id: nextId('tts-job'),
      type: 'tts',
      status: 'running',
      progress: 10,
      params: { text, voiceId },
      pluginId: 'tts-mock',
    })
    updateJob(job)
    timers.set(
      job.id,
      setTimeout(() => {
        timers.delete(job.id)
        updateJob(JobSchema.parse({ ...job, status: 'done', progress: 100, result: { assetIds: [assetId] } }))
      }, delayMs),
    )
    return job
  }

  return {
    id: 'tts-mock',
    name: 'Mock TTS',
    voices: [
      { id: 'zh-female', name: '晓梅', gender: 'female' },
      { id: 'zh-male', name: '大伟', gender: 'male' },
    ],
    synthesize,
    getJob,
    cancelJob,
    onJobUpdate,
    waitForJob,
    getAsset,
  }
}

export function createTTSSyncPlugin(opts?: TTSSyncMockOptions): ProviderPlugin<TTSProvider> {
  const instance = createTTSSyncMock(opts)
  return {
    id: 'tts-mock',
    name: 'Mock TTS',
    kind: 'provider',
    providerType: 'tts',
    enabled: true,
    instance,
  }
}
