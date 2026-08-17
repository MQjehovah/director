import { ref } from 'vue'
import { usePluginStore } from '../../stores/pluginStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useJobStore } from '../../stores/jobStore'
import type { Asset, Job, Shot } from '../../core/models'
import type { MediaCapability } from '../../core/plugin/types'
import { capabilityForJobType } from '../../providers/capabilities'
import type { MediaCapabilityProvider } from '../../providers/capabilities'
import type { MediaProvider } from '../../providers/MediaProvider'
import { persistGeneratedAssets } from '../shared/persistGeneratedAssets'
import type { AssetResolver } from '../shared/persistGeneratedAssets'

type AssetResolvingMediaProvider = MediaProvider & {
  getAsset?: (assetId: string) => Promise<Asset | undefined>
}

const thumbUrls = ref<Record<string, string>>({})
const resolving = new Set<string>()

function isImageSrc(value: string): boolean {
  return (
    value.startsWith('data:') ||
    value.startsWith('http') ||
    value.startsWith('/') ||
    value.startsWith('blob:')
  )
}

/** 镜头用于 image2video 的输入图 id（记录于 metadata，避免与输出视频资产混淆） */
function recordedInputImage(shot: Shot | undefined): string | undefined {
  const value = shot?.metadata?.inputImageAssetId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 展示用资产：生成结果总是追加在 mediaAssets 末尾，取最后一项，
 * 避免 image2video（输入图 + 输出视频）把输入图误当结果展示 */
export function displayAssetOf(shot: Shot | undefined): string | undefined {
  const assets = shot?.mediaAssets ?? []
  return assets.length > 0 ? assets[assets.length - 1] : undefined
}

/** 计算 image2video 的输入图：显式记录优先，其次回退到 mediaAssets 中的图片直链 */
function imageInputFor(shot: Shot | undefined): string | undefined {
  const recorded = recordedInputImage(shot)
  if (recorded) return recorded
  // 场次场景图作为该场镜头的视觉锚点：视频镜头优先用它做图生视频底图
  const sceneImage = shot?.metadata?.sceneImageAssetId
  if (typeof sceneImage === 'string' && sceneImage.length > 0) return sceneImage
  const first = shot?.mediaAssets[0]
  return first && isImageSrc(first) ? first : undefined
}

/** 按镜头需求选择能力：image → text2image；video → image2video（有输入图）或 text2video */
function capabilityForShot(shot: Shot | undefined): MediaCapability {
  if (!shot || shot.shotType !== 'video') return 'text2image'
  return imageInputFor(shot) ? 'image2video' : 'text2video'
}

const SHOT_SIZE_LABELS: Record<string, string> = {
  'close-up': '特写',
  medium: '中景',
  wide: '全景',
}

const ANGLE_LABELS: Record<string, string> = {
  'eye-level': '平视',
  high: '俯视',
  low: '仰视',
  dutch: '倾斜',
}

/** 向前找最近一段已生成视频的资产 id，用于视频续写（参照上一段结尾继续生成） */
export function findPreviousVideoAssetId(shots: Shot[], shotId: string): string | undefined {
  const index = shots.findIndex((s) => s.id === shotId)
  if (index <= 0) return undefined
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = shots[i]
    if (prev.shotType !== 'video') continue
    const last = prev.mediaAssets[prev.mediaAssets.length - 1]
    if (last) return last
  }
  return undefined
}

const MOVE_LABELS: Record<string, string> = {
  static: '固定机位',
  pan: '横摇',
  tilt: '俯仰',
  'zoom-in': '推近',
  'zoom-out': '拉远',
  tracking: '跟拍',
}

/** 组装镜头提示词：用户画面描述 + 镜头语言（景别/机位/运镜/时长） */
export function buildShotPrompt(shot: Shot): string {
  const base = shot.prompt?.trim() ?? ''
  const sceneContext = shot.metadata?.sceneContext
  const contextPrefix =
    typeof sceneContext === 'string' && sceneContext.trim() ? `场景：${sceneContext.trim()}，` : ''
  const camera = shot.camera
  if (!camera) return `${contextPrefix}${base}`
  const parts: string[] = []
  if (base) parts.push(base)
  const size = SHOT_SIZE_LABELS[camera.shotSize]
  const angle = ANGLE_LABELS[camera.angle]
  const move = MOVE_LABELS[camera.move]
  const language = [size, angle, move].filter(Boolean).join('，')
  if (language) parts.push(language)
  if (shot.shotType === 'video' && camera.duration > 0) {
    parts.push(`时长约 ${camera.duration} 秒`)
  }
  return `${contextPrefix}${parts.join('，')}`
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

  function previousVideoAssetId(shotId: string): string | undefined {
    return findPreviousVideoAssetId(storyboardStore.shots, shotId)
  }

  async function generateMedia(shotId: string): Promise<Job | undefined> {
    const shot = storyboardStore.shotById(shotId)
    if (!shot) return undefined

    const existing = jobForShot(shotId)
    if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing

    const media = pluginStore.resolveInstanceCapability<MediaCapabilityProvider>(
      'media',
      capabilityForShot(shot),
    )
    if (!media) return undefined

    const prompt = buildShotPrompt(shot)
    let providerJob: Job
    try {
      if (shot.shotType === 'video') {
        const imageAssetId = imageInputFor(shot)
        const continueFromPrev = shot.metadata?.continueFromPrev === true
        const prevVideoAssetId = continueFromPrev ? previousVideoAssetId(shotId) : undefined
        providerJob = imageAssetId
          ? await media.generateVideo({
              imageAssetId,
              prompt: prompt || undefined,
              shotRef: shotId,
              duration: shot.camera?.duration,
              prevVideoAssetId,
            })
          : await media.generateVideo({
              prompt,
              shotRef: shotId,
              duration: shot.camera?.duration,
              prevVideoAssetId,
            })
        // 记录 image2video 输入图与续写来源，供二次生成路由与引用
        const metadata = { ...(shot.metadata ?? {}) }
        if (imageAssetId) {
          metadata.inputImageAssetId = imageAssetId
        }
        if (prevVideoAssetId) {
          metadata.continuationFrom = prevVideoAssetId
        }
        storyboardStore.updateShot(shotId, { metadata })
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

    const applyAsset = async (assetIds: string[]): Promise<void> => {
      if (assetIds.length === 0) return
      await persistGeneratedAssets(assetIds, media as AssetResolver)
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
        void applyAsset(updated.result?.assetIds ?? [])
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
        jobStore.updateJob(latest)
        await applyAsset(latest.result?.assetIds ?? [])
        finish()
      } else if (latest.status === 'failed' || latest.status === 'canceled') {
        jobStore.updateJob(latest)
        finish()
      }
    } catch {
      // provider may not support getJob for this job; rely on listener
    }

    return job
  }

  async function cancelGeneration(shotId: string): Promise<void> {
    const job = jobForShot(shotId)
    if (!job) return
    if (job.status !== 'queued' && job.status !== 'running') return
    // 任务属于创建它的 Provider（job.pluginId），切换 Provider 后仍取消到正确的实例；
    // 缺少 pluginId 时按任务类型解析具备该能力的 Provider。
    const cap = capabilityForJobType(job.type)
    const media =
      pluginStore.getProviderInstance<MediaCapabilityProvider>(job.pluginId) ??
      (cap
        ? pluginStore.resolveInstanceCapability<MediaCapabilityProvider>('media', cap)
        : undefined)
    if (!media) return
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
    if (resolving.has(assetId)) return undefined
    resolving.add(assetId)
    try {
      // 生成资产已镜像到存储 Provider 时优先按原 id 解析，保证刷新后仍可显示
      const storage = pluginStore.storageProvider
      if (storage?.loadAsset) {
        const stored = await storage.loadAsset(assetId)
        if (stored) {
          const url = await storage.getAssetUrl(stored)
          if (url) {
            thumbUrls.value[assetId] = url
            return url
          }
        }
      }
      // 遍历所有启用的媒体 Provider：生成可能走任一 Provider（如 ComfyUI），
      // 资产由持有它的 Provider 解析
      for (const provider of pluginStore.enabledProviders('media')) {
        const instance = provider.instance as AssetResolvingMediaProvider | undefined
        if (instance?.getAsset) {
          const asset = await instance.getAsset(assetId)
          if (asset?.url) {
            thumbUrls.value[assetId] = asset.url
            return asset.url
          }
        }
      }
      return undefined
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
