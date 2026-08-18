import { ref } from 'vue'
import { usePluginStore } from '../../stores/pluginStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useJobStore } from '../../stores/jobStore'
import type { Asset, Job, Shot } from '../../core/models'
import type { MediaCapability } from '../../core/plugin/types'
import { capabilityForJobType } from '../../providers/capabilities'
import type { MediaCapabilityProvider } from '../../providers/capabilities'
import type { ImageToVideoParams, MediaProvider } from '../../providers/MediaProvider'
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

/** 镜头显式上传/记录的首帧图 id（记录于 metadata，避免与输出视频资产混淆） */
function recordedFirstFrame(shot: Shot | undefined): string | undefined {
  const value = shot?.metadata?.firstFrameAssetId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 镜头显式上传的尾帧图 id（首尾帧文生视频的尾帧） */
function recordedLastFrame(shot: Shot | undefined): string | undefined {
  const value = shot?.metadata?.lastFrameAssetId
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 展示用资产：生成结果总是追加在 mediaAssets 末尾，取最后一项，
 * 避免 image2video（输入图 + 输出视频）把输入图误当结果展示 */
export function displayAssetOf(shot: Shot | undefined): string | undefined {
  const assets = shot?.mediaAssets ?? []
  return assets.length > 0 ? assets[assets.length - 1] : undefined
}

/** 计算 image2video 的首帧输入图：显式首帧优先，其次历史记录/场次场景图/mediaAssets 图片 */
function imageInputFor(shot: Shot | undefined): string | undefined {
  const recorded = recordedFirstFrame(shot)
  if (recorded) return recorded
  const historical = shot?.metadata?.inputImageAssetId
  if (typeof historical === 'string' && historical.length > 0) return historical
  // 场次场景图作为该场镜头的视觉锚点：视频镜头优先用它做图生视频底图
  const sceneImage = shot?.metadata?.sceneImageAssetId
  if (typeof sceneImage === 'string' && sceneImage.length > 0) return sceneImage
  const first = shot?.mediaAssets[0]
  return first && isImageSrc(first) ? first : undefined
}

/** 计算 image2video 的尾帧输入图 */
function lastFrameInputFor(shot: Shot | undefined): string | undefined {
  return recordedLastFrame(shot)
}

/**
 * 按镜头需求选择能力：
 * - image → text2image（文生图）
 * - video + 首尾帧 → firstLastFrameVideo（首尾帧生视频）
 * - video + 单帧 → image2video（参考生视频）
 * - video 无帧 → text2video（文生视频）
 */
function capabilityForShot(shot: Shot | undefined): MediaCapability {
  if (!shot || shot.shotType !== 'video') return 'text2image'
  const first = imageInputFor(shot)
  const last = lastFrameInputFor(shot)
  if (first && last) return 'firstLastFrameVideo'
  if (first || last) return 'image2video'
  return 'text2video'
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

  async function generateMedia(shotId: string): Promise<Job | undefined> {
    const shot = storyboardStore.shotById(shotId)
    if (!shot) return undefined

    const existing = jobForShot(shotId)
    if (existing && (existing.status === 'queued' || existing.status === 'running')) return existing

    const capability = capabilityForShot(shot)
    let media = pluginStore.resolveInstanceCapability<MediaCapabilityProvider>('media', capability)
    // 旧 Provider 未声明首尾帧能力时回退到参考生视频（忽略尾帧或按自身实现处理）
    if (!media && capability === 'firstLastFrameVideo') {
      media = pluginStore.resolveInstanceCapability<MediaCapabilityProvider>(
        'media',
        'image2video',
      )
    }
    if (!media) return undefined

    const prompt = buildShotPrompt(shot)
    let providerJob: Job
    try {
      if (shot.shotType === 'video') {
        const imageAssetId = imageInputFor(shot)
        const lastFrameAssetId = lastFrameInputFor(shot)
        const videoParams: ImageToVideoParams = {
          prompt: prompt || undefined,
          shotRef: shotId,
          duration: shot.camera?.duration,
        }
        if (imageAssetId) videoParams.imageAssetId = imageAssetId
        if (lastFrameAssetId) videoParams.lastFrameAssetId = lastFrameAssetId
        providerJob = await media.generateVideo(videoParams)
        // 记录 image2video 的首帧输入图，供二次生成路由与引用
        const metadata = { ...(shot.metadata ?? {}) }
        if (imageAssetId) {
          metadata.inputImageAssetId = imageAssetId
          metadata.firstFrameAssetId = imageAssetId
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
