import { ref } from 'vue'
import { usePluginStore } from '../../stores/pluginStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useJobStore } from '../../stores/jobStore'
import type { Asset, Job } from '../../core/models'
import type { MediaProvider } from '../../providers/MediaProvider'

type AssetResolvingMediaProvider = MediaProvider & {
  getAsset?: (assetId: string) => Promise<Asset | undefined>
}

const thumbUrls = ref<Record<string, string>>({})
const resolving = new Set<string>()

function isImageSrc(value: string): boolean {
  return value.startsWith('data:') || value.startsWith('http') || value.startsWith('/')
}

export function useShotActions() {
  const storyboardStore = useStoryboardStore()
  const jobStore = useJobStore()
  const pluginStore = usePluginStore()

  function jobForShot(shotId: string): Job | undefined {
    const jobs = jobStore.jobsForShot(shotId)
    if (jobs.length === 0) return undefined
    const active = [...jobs].reverse().find((j) => j.status === 'queued' || j.status === 'running')
    return active ?? jobs[jobs.length - 1]
  }

  async function generateMedia(shotId: string): Promise<Job | undefined> {
    const media = pluginStore.mediaProvider
    const shot = storyboardStore.shotById(shotId)
    if (!media || !shot) return undefined

    const existing = jobForShot(shotId)
    if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing

    const prompt = shot.prompt?.trim() ?? ''
    let providerJob: Job
    try {
      if (shot.shotType === 'video') {
        const imageAssetId = shot.mediaAssets[0]
        providerJob = imageAssetId
          ? await media.generateVideo({ imageAssetId, prompt: prompt || undefined, shotRef: shotId })
          : await media.generateVideo({ prompt, shotRef: shotId })
      } else {
        providerJob = await media.generateImage({
          prompt,
          negativePrompt: shot.negativePrompt,
          seed: shot.seed,
          shotRef: shotId,
        })
      }
    } catch (err) {
      throw new Error(`媒体生成失败：${err instanceof Error ? err.message : String(err)}`)
    }

    const job = jobStore.addJob({
      id: providerJob.id,
      type: providerJob.type,
      status: providerJob.status,
      progress: providerJob.progress,
      pluginId: providerJob.pluginId,
      shotRef: shotId,
      params: providerJob.params,
      result: providerJob.result,
    })
    storyboardStore.updateShot(shotId, { renderJobRef: job.id })

    const applyAsset = (assetIds: string[]): void => {
      if (assetIds.length === 0) return
      const current = storyboardStore.shotById(shotId)
      if (current) {
        storyboardStore.updateShot(shotId, {
          mediaAssets: [...current.mediaAssets, ...assetIds],
        })
      }
    }

    const finish = (): void => {
      off()
    }

    const off = media.onJobUpdate((updated) => {
      if (updated.id !== job.id) return
      jobStore.updateJob(updated)
      if (updated.status === 'done') {
        applyAsset(updated.result?.assetIds ?? [])
        finish()
      } else if (updated.status === 'failed' || updated.status === 'canceled') {
        finish()
      }
    })

    // Reconcile: a provider may have completed synchronously before the
    // listener was registered (push/SSE/instant providers).
    try {
      const latest = await media.getJob(job.id)
      if (latest.status === 'done') {
        applyAsset(latest.result?.assetIds ?? [])
        finish()
      } else if (latest.status === 'failed' || latest.status === 'canceled') {
        finish()
      }
    } catch {
      // provider may not support getJob for this job; rely on listener
    }

    return job
  }

  async function cancelGeneration(shotId: string): Promise<void> {
    const media = pluginStore.mediaProvider
    const job = jobForShot(shotId)
    if (!media || !job) return
    if (job.status !== 'queued' && job.status !== 'running') return
    try {
      await media.cancelJob(job.id)
    } catch {
      // provider cancel failed; still mark the job canceled locally
    }
    jobStore.markCanceled(job.id)
  }

  async function regenerate(shotId: string): Promise<Job | undefined> {
    const shot = storyboardStore.shotById(shotId)
    if (!shot) return undefined
    await cancelGeneration(shotId)
    storyboardStore.updateShot(shotId, { mediaAssets: [], renderJobRef: undefined })
    return generateMedia(shotId)
  }

  async function resolveAssetUrl(assetId: string): Promise<string | undefined> {
    if (thumbUrls.value[assetId]) return thumbUrls.value[assetId]
    if (isImageSrc(assetId)) {
      thumbUrls.value[assetId] = assetId
      return assetId
    }
    const media = pluginStore.mediaProvider as AssetResolvingMediaProvider | undefined
    if (!media?.getAsset || resolving.has(assetId)) return undefined
    resolving.add(assetId)
    try {
      const asset = await media.getAsset(assetId)
      if (asset?.url) thumbUrls.value[assetId] = asset.url
      return asset?.url
    } catch {
      return undefined
    } finally {
      resolving.delete(assetId)
    }
  }

  function thumbUrl(assetId: string | undefined): string | undefined {
    return assetId ? thumbUrls.value[assetId] : undefined
  }

  return { generateMedia, cancelGeneration, regenerate, jobForShot, resolveAssetUrl, thumbUrl }
}
