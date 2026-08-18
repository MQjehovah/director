import { ref } from 'vue'
import { usePluginStore } from '../../stores/pluginStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useJobStore } from '../../stores/jobStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useCharacterStore } from '../../stores/characterStore'
import type { Asset, Character, Job, Scene, Shot } from '../../core/models'
import type { MediaCapability } from '../../core/plugin/types'
import { capabilityForJobType } from '../../providers/capabilities'
import type { MediaCapabilityProvider } from '../../providers/capabilities'
import type { ImageToVideoParams, MediaProvider } from '../../providers/MediaProvider'
import { getWorkflowTemplate } from '../comfyui/workflowStore'
import type { WorkflowParameter } from '../comfyui/workflowStore'
import { loadProviderConfig } from '../settings/httpBackendConfig'
import { MEDIA_COMFYUI_ID } from '../../plugins/providers/media-comfyui'
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

/** 镜头显式选择的参考图 id（参考生视频：本镜头上传或取自角色/场景参考图） */
function selectedReference(shot: Shot | undefined): string | undefined {
  const value = shot?.metadata?.referenceImageAssetId
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
  const selected = selectedReference(shot)
  if (selected) return selected
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

/** 镜头所在场次 */
function sceneForShot(shot: Shot | undefined): Scene | undefined {
  if (!shot?.sceneId) return undefined
  return useScriptStore().scenes.find((s) => s.id === shot.sceneId)
}

/** 镜头所在场次台词中出现过的角色（按说话人名称匹配） */
function charactersForShot(shot: Shot | undefined): Character[] {
  const scene = sceneForShot(shot)
  const speakers = new Set<string>()
  for (const beat of scene?.beats ?? []) {
    const name = beat.dialogue?.speaker?.trim()
    if (name) speakers.add(name)
  }
  if (speakers.size === 0) return []
  return useCharacterStore().characters.filter((c) => speakers.has(c.name.trim()))
}

/** 收集参考生视频的输入：显式参考 → 首帧 → 场次场景图 → 场次参考图 → 角色参考图；去重，最多 9 张 */
function referenceAssetsForShot(
  shot: Shot | undefined,
): { ids: string[]; labels: string[]; characterContext: string } {
  const ids: string[] = []
  const labels: string[] = []
  const seen = new Set<string>()
  const push = (id: string | undefined, label: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
    labels.push(label)
  }
  const metadata = shot?.metadata ?? {}
  push(typeof metadata.referenceImageAssetId === 'string' ? metadata.referenceImageAssetId : undefined, '参考图')
  push(typeof metadata.firstFrameAssetId === 'string' ? metadata.firstFrameAssetId : undefined, '首帧')
  push(typeof metadata.sceneImageAssetId === 'string' ? metadata.sceneImageAssetId : undefined, '场景')
  const scene = sceneForShot(shot)
  push(scene?.sceneImage, '场景')
  for (const r of scene?.referenceImages ?? []) push(r, '场景参考图')
  const characters = charactersForShot(shot)
  for (const c of characters) {
    if (ids.length >= 9) break
    push(c.referenceImages[0], `角色「${c.name}」`)
  }
  const characterContext = characters
    .map((c) => {
      const parts = [
        c.name,
        c.bio,
        c.appearance,
        c.tags.length > 0 ? `标签：${c.tags.join('、')}` : '',
      ]
      return parts.filter(Boolean).join('；')
    })
    .join('\n')
  return { ids: ids.slice(0, 9), labels: labels.slice(0, 9), characterContext }
}

/** 渲染绑定的参数类型：按模板参数描述（来自 object_info 字段类型）查找，key 为 `${nodeId}:${input}` */
function renderParamType(
  templateId: string | undefined,
  key: string,
): WorkflowParameter['type'] | undefined {
  if (!templateId) return undefined
  const tpl = getWorkflowTemplate(templateId)
  return tpl?.parameters?.find((p) => `${p.nodeId}:${p.input}` === key)?.type
}

/**
 * 按镜头需求选择能力：
 * - image → text2image（文生图）
 * - video 显式 videoMode → 按用户选择路由（缺参考时回退）
 * - video 未设置 → 首尾帧/单帧/无帧自动推断
 */
function capabilityForShot(shot: Shot | undefined): MediaCapability {
  if (!shot || shot.shotType !== 'video') return 'text2image'
  // 渲染区块显式选择参考生视频：走 image2video 模板（多参考绑定）
  if (shot.render?.mode === 'ref2v') return 'image2video'
  if (shot.render?.mode === 'text2video') return 'text2video'
  const first = imageInputFor(shot)
  const last = lastFrameInputFor(shot)
  switch (shot.videoMode) {
    case 'text2video':
      return 'text2video'
    case 'image2video':
      return first ? 'image2video' : 'text2video'
    case 'firstLastFrameVideo':
      if (first && last) return 'firstLastFrameVideo'
      if (first || last) return 'image2video'
      return 'text2video'
    default:
      if (first && last) return 'firstLastFrameVideo'
      if (first || last) return 'image2video'
      return 'text2video'
  }
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
export function buildShotPrompt(shot: Shot, globalContext?: string): string {
  const base = shot.prompt?.trim() ?? ''
  const prefixes: string[] = []
  const global = globalContext?.trim()
  if (global) prefixes.push(`风格：${global}`)
  const sceneContext = shot.metadata?.sceneContext
  if (typeof sceneContext === 'string' && sceneContext.trim()) {
    prefixes.push(`场景：${sceneContext.trim()}`)
  }
  const contextPrefix = prefixes.length > 0 ? `${prefixes.join('，')}，` : ''
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
  const scriptStore = useScriptStore()

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

    const prompt = buildShotPrompt(shot, scriptStore.script?.globalContext)
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
        // 显式文生视频不携带参考图/首尾帧，避免 Provider 误路由
        if (capability !== 'text2video') {
          if (imageAssetId) videoParams.imageAssetId = imageAssetId
          if (lastFrameAssetId) videoParams.lastFrameAssetId = lastFrameAssetId
          const renderCfg = loadProviderConfig(MEDIA_COMFYUI_ID)
          const renderTemplateId =
            shot.render?.mode === 'ref2v' &&
            typeof renderCfg?.imageVideoWorkflowTemplateId === 'string'
              ? renderCfg.imageVideoWorkflowTemplateId
              : undefined
          const explicitRefIds: string[] = []
          const explicitRefVideoIds: string[] = []
          const scalarOverrides: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(shot.render?.params ?? {})) {
            if (value === undefined || value === null || value === '') continue
            const type = renderParamType(renderTemplateId, key)
            if (type === 'image') {
              if (typeof value === 'string') explicitRefIds.push(value)
            } else if (type === 'video') {
              if (typeof value === 'string') explicitRefVideoIds.push(value)
            } else {
              scalarOverrides[key] = value
            }
          }
          const auto = referenceAssetsForShot(shot)
          const refs =
            explicitRefIds.length > 0
              ? {
                  ids: explicitRefIds,
                  labels: explicitRefIds.map((_, i) => `参考图 ${i + 1}`),
                }
              : { ids: auto.ids, labels: auto.labels }
          if (refs.ids.length > 0) {
            videoParams.referenceAssetIds = refs.ids
            videoParams.referenceLabels = refs.labels
          }
          if (auto.characterContext.trim()) {
            videoParams.characterContext = auto.characterContext
          }
          if (explicitRefVideoIds.length > 0) {
            videoParams.referenceVideoIds = explicitRefVideoIds
          }
          if (Object.keys(scalarOverrides).length > 0) {
            videoParams.templateOverrides = scalarOverrides
          }
        }
        providerJob = await media.generateVideo(videoParams)
        // 记录 image2video 的首帧输入图，供二次生成路由与引用
        const metadata = { ...(shot.metadata ?? {}) }
        if (capability !== 'text2video' && imageAssetId) {
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
