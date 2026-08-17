import { useCharacterStore } from '../../stores/characterStore'
import { useJobStore } from '../../stores/jobStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import {
  AngleSchema,
  DEFAULT_SHOT_DURATION,
  MAX_SHOT_DURATION,
  MoveSchema,
  ShotSizeSchema,
} from '../../core/models'
import type { Job, Scene, Script, Shot } from '../../core/models'
import type { MediaCapabilityProvider } from '../../providers/capabilities'
import type { LlmFeatureResult } from '../shared/llmResult'
import { persistGeneratedAssets } from '../shared/persistGeneratedAssets'
import type { AssetResolver } from '../shared/persistGeneratedAssets'

export const SCRIPT_GENERATION_PROMPT =
  '你是一位动画导演。请根据下面的灵感，用中文创作一份完整的剧本。要求：' +
  '每个场景以 "# 场景标题" 开头；台词使用 "角色名：台词" 格式；动作使用 "动作：描述"；' +
  '音效使用 "音效：描述"。只输出剧本正文，不要任何额外说明。\n\n'

export const BEAT_REWRITE_PROMPT =
  '你是一位动画编剧。请根据下面的改写指令改写给定的叙事节拍。要求：' +
  '对话输出为 "角色名：台词"，动作输出为 "动作：描述"，音效输出为 "音效：描述"。' +
  '只输出改写后的节拍内容，不要任何额外说明。\n\n原始节拍：'

export const CUT_SCENE_SHOTS_PROMPT =
  '你是一位动画导演兼分镜师。请根据下面的场次内容，把整场戏拆解为分镜（镜头列表）。\n' +
  '要求：\n' +
  '- 镜头数量由叙事节奏决定，不要与节拍一一对应：一个节拍可以拆成多个镜头，多个节拍可以合并进一个镜头。\n' +
  '- 每个镜头包含：prompt（画面描述，可直接用于 AI 生图，写清地点、时间、人物、动作、情绪、光影）；' +
  'type（"image" 或 "video"）；shotSize（"close-up"、"medium"、"wide"）；' +
  'angle（"eye-level"、"high"、"low"、"dutch"）；move（"static"、"pan"、"tilt"、"zoom-in"、"zoom-out"、"tracking"）；' +
  'duration（数字，3 到 10 秒）；beatRef（可选字符串，对应节拍 id）；' +
  'dialogue（可选数组，元素为 {"speaker":"角色名","text":"台词"}，把该镜头内出现的台词完整保留，无台词则不包含）。\n' +
  '- 对话强调表情时用特写+固定机位，动作场面用中景/全景+运镜，戏剧高潮可用 video 镜头。\n' +
  '- 同一场次的镜头保持场景一致（地点、时间、光线）。\n' +
  '- 只输出 JSON，不要任何额外说明或代码块标记。\n\n' +
  '{sceneInfo}\n\n节拍列表：\n{beats}\n\n' +
  '输出一个 JSON 对象，包含 shots 数组，字段与取值如上所述。'

export interface LlmShotSpec {
  prompt: string
  type: 'image' | 'video'
  shotSize?: 'close-up' | 'medium' | 'wide'
  angle?: 'eye-level' | 'high' | 'low' | 'dutch'
  move?: 'static' | 'pan' | 'tilt' | 'zoom-in' | 'zoom-out' | 'tracking'
  duration?: number
  beatRef?: string
  dialogue?: Array<{ speaker: string; text: string }>
}

function serializeBeatsForCut(scene: Scene): string {
  return scene.beats
    .map((b, i) => {
      if (b.type === 'dialogue') {
        return `${i + 1}. [对话 ${b.id}] ${b.dialogue?.speaker ?? ''}：${b.dialogue?.text ?? ''}`
      }
      const label = b.type === 'sfx' ? '音效' : '动作'
      return `${i + 1}. [${label} ${b.id}] ${b.action ?? ''}`
    })
    .join('\n')
}

function buildCutPrompt(scene: Scene): string {
  const lines = [`场次标题：${scene.title ?? '未命名场次'}`]
  lines.push(`场景描述：${scene.description?.trim() || '无'}`)
  if (scene.location) lines.push(`地点：${scene.location}`)
  if (scene.timeOfDay) lines.push(`时间：${scene.timeOfDay}`)
  return CUT_SCENE_SHOTS_PROMPT.replace('{sceneInfo}', lines.join('\n')).replace(
    '{beats}',
    serializeBeatsForCut(scene),
  )
}

function parseLlmShots(text: string, scene: Scene): LlmShotSpec[] | undefined {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(first, last + 1))
  } catch {
    return undefined
  }
  const list = (parsed as { shots?: unknown })?.shots
  if (!Array.isArray(list)) return undefined
  const beatIds = new Set(scene.beats.map((b) => b.id))
  const specs: LlmShotSpec[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const duration = Number(r.duration)
    const shotSize = ShotSizeSchema.safeParse(r.shotSize)
    const angle = AngleSchema.safeParse(r.angle)
    const move = MoveSchema.safeParse(r.move)
    const beatRef =
      typeof r.beatRef === 'string' && beatIds.has(r.beatRef) ? r.beatRef : undefined
    const rawDialogue = r.dialogue
    let dialogue: LlmShotSpec['dialogue']
    if (Array.isArray(rawDialogue)) {
      dialogue = rawDialogue
        .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
        .map((d) => ({
          speaker: typeof d.speaker === 'string' ? d.speaker : '',
          text: typeof d.text === 'string' ? d.text : '',
        }))
        .filter((d) => d.text.trim().length > 0)
    }
    specs.push({
      prompt: typeof r.prompt === 'string' ? r.prompt : '',
      // 默认视频：只有模型明确给出 image 才按图片处理
      type: r.type === 'image' ? 'image' : 'video',
      shotSize: shotSize.success ? shotSize.data : undefined,
      angle: angle.success ? angle.data : undefined,
      move: move.success ? move.data : undefined,
      duration:
        Number.isFinite(duration) && duration > 0
          ? Math.min(Math.max(duration, 3), MAX_SHOT_DURATION)
          : DEFAULT_SHOT_DURATION,
      beatRef,
      dialogue,
    })
  }
  return specs.length > 0 ? specs : undefined
}

/** 场景图提示词：优先使用用户保存的 imagePrompt，否则按地点/时间拼装 */
export function buildScenePrompt(scene: Scene | undefined): string {
  if (!scene) return ''
  const stored = scene.metadata?.imagePrompt
  if (typeof stored === 'string' && stored.trim().length > 0) return stored
  // 场景描述就是该场的通用 prompt；旧数据的 地点/时间 作为回退
  const description = scene.description?.trim()
  if (description) return `${description}场景概念图，动画风格`
  const parts = [scene.location, scene.timeOfDay].filter(Boolean)
  return parts.length > 0 ? `${parts.join('，')}场景概念图，动画风格` : '场景概念图，动画风格'
}

export function useScriptFeatures() {
  const scriptStore = useScriptStore()
  const storyboardStore = useStoryboardStore()
  const pluginStore = usePluginStore()
  const characterStore = useCharacterStore()
  const jobStore = useJobStore()

  function characterContext(): string {
    const names = characterStore.characters.map((c) => c.name).filter(Boolean)
    return names.length > 0 ? `剧本中可用的角色：${names.join('、')}。\n` : ''
  }

  function serializeBeat(sceneId: string, beatId: string): string {
    const scene = scriptStore.scenes.find((s) => s.id === sceneId)
    const beat = scene?.beats.find((b) => b.id === beatId)
    if (!beat) return ''
    if (beat.type === 'dialogue') {
      return `${beat.dialogue?.speaker ?? ''}：${beat.dialogue?.text ?? ''}`
    }
    return `${beat.type === 'sfx' ? '音效' : '动作'}：${beat.action ?? ''}`
  }

  async function generateScriptFromIdea(idea: string): Promise<LlmFeatureResult> {
    const llm = pluginStore.llmProvider
    if (!llm) return { ok: false, error: '未配置 LLM Provider，无法生成剧本。' }
    try {
      const text = await llm.complete(`${SCRIPT_GENERATION_PROMPT}${characterContext()}灵感：${idea}`)
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: `剧本生成失败：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async function rewriteBeat(sceneId: string, beatId: string, instruction: string): Promise<LlmFeatureResult> {
    const llm = pluginStore.llmProvider
    if (!llm) return { ok: false, error: '未配置 LLM Provider，无法改写节拍。' }
    const beatText = serializeBeat(sceneId, beatId)
    if (!beatText) return { ok: false, error: '节拍不存在。' }
    try {
      const text = await llm.complete(`${BEAT_REWRITE_PROMPT}${beatText}\n改写指令：${instruction}`)
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: `节拍改写失败：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  function applyLlmShots(sceneId: string, specs: LlmShotSpec[]): Shot[] {
    const scene = scriptStore.scenes.find((s) => s.id === sceneId)
    const context = scene
      ? scene.description?.trim() ||
        [scene.location, scene.timeOfDay].filter(Boolean).join('，')
      : ''
    storyboardStore.removeSceneShots(sceneId)
    const created: Shot[] = []
    for (const spec of specs) {
      const dialogueText = spec.dialogue
        ?.map((d) => `${d.speaker ? `${d.speaker}：` : ''}${d.text}`)
        .join('\n')
      const shot = storyboardStore.addShot({
        sceneId,
        shotType: spec.type,
        prompt: spec.prompt.trim() || undefined,
        beatRef: spec.beatRef,
        camera: {
          shotSize: spec.shotSize ?? 'medium',
          angle: spec.angle ?? 'eye-level',
          move: spec.move ?? 'static',
          duration: spec.duration ?? DEFAULT_SHOT_DURATION,
        },
        metadata: {
          ...(scene?.sceneImage ? { sceneImageAssetId: scene.sceneImage } : {}),
          ...(context ? { sceneContext: context } : {}),
          ...(dialogueText ? { dialogue: dialogueText } : {}),
        },
      })
      created.push(shot)
    }
    return created
  }

  async function cutSceneToShots(sceneId: string): Promise<Shot[]> {
    const scene = scriptStore.scenes.find((s) => s.id === sceneId)
    if (!scene) return []
    const llm = pluginStore.llmProvider
    if (llm) {
      try {
        const text = await llm.complete(buildCutPrompt(scene))
        const specs = parseLlmShots(text, scene)
        if (specs && specs.length > 0) {
          return applyLlmShots(sceneId, specs)
        }
      } catch {
        // 大模型切分失败时回退到节拍切分
      }
    }
    return storyboardStore.cutSceneToShots(scene)
  }

  function importScript(md: string): Script {
    return scriptStore.importMarkdown(md)
  }

  /**
   * 生成场次场景图：有参考图且媒体 Provider 支持 editImage 时走图生图（参考生图），
   * 否则回退到文生图。完成后把资产写入 scene.sceneImage。
   */
  async function generateSceneImage(sceneId: string): Promise<Job | undefined> {
    const scene = scriptStore.scenes.find((s) => s.id === sceneId)
    if (!scene) return undefined
    const prompt = buildScenePrompt(scene)
    const reference = scene.referenceImages[scene.referenceImages.length - 1]
    const mode = scene.artMode ?? 'auto'
    const useImg2Img = mode === 'img2img' || (mode === 'auto' && !!reference)

    let provider: MediaCapabilityProvider | undefined
    let providerJob: Job | undefined
    if (useImg2Img) {
      if (!reference) {
        throw new Error('图生图模式需要先上传参考图。')
      }
      provider = pluginStore.resolveInstanceCapability<MediaCapabilityProvider>('media', 'editImage')
      if (!provider) {
        throw new Error('未配置支持图生图的媒体 Provider（请启用 ComfyUI 并配置图生图工作流模板）。')
      }
      try {
        providerJob = await provider.editImage({
          imageAssetId: reference,
          prompt,
          shotRef: undefined,
        })
      } catch (err) {
        throw new Error(`场景图生成失败：${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      provider = pluginStore.resolveInstanceCapability<MediaCapabilityProvider>('media', 'text2image')
      if (!provider) return undefined
      try {
        providerJob = await provider.generateImage({ prompt, shotRef: undefined })
      } catch (err) {
        throw new Error(`场景图生成失败：${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const activeProvider = provider
    if (!activeProvider || !providerJob) return undefined

    const job = jobStore.addJob({
      id: providerJob.id,
      type: providerJob.type,
      status: providerJob.status,
      progress: providerJob.progress,
      pluginId: providerJob.pluginId,
      params: providerJob.params,
      result: providerJob.result,
    })

    const applyAsset = async (assetIds: string[]): Promise<void> => {
      if (assetIds.length === 0) return
      await persistGeneratedAssets(assetIds, activeProvider as AssetResolver)
      const current = scriptStore.scenes.find((s) => s.id === sceneId)
      if (current) {
        scriptStore.updateScene(sceneId, {
          sceneImage: assetIds[assetIds.length - 1],
        })
      }
    }

    const off = activeProvider.onJobUpdate((updated) => {
      if (updated.id !== job.id) return
      jobStore.updateJob(updated)
      if (updated.status === 'done') {
        void applyAsset(updated.result?.assetIds ?? [])
        off()
      } else if (updated.status === 'failed' || updated.status === 'canceled') {
        off()
      }
    })

    try {
      const latest = await activeProvider.getJob(job.id)
      if (latest.status === 'done') {
        jobStore.updateJob(latest)
        await applyAsset(latest.result?.assetIds ?? [])
        off()
      } else if (latest.status === 'failed' || latest.status === 'canceled') {
        jobStore.updateJob(latest)
        off()
      }
    } catch {
      // provider may not support getJob; rely on listener
    }

    return job
  }

  return {
    generateScriptFromIdea,
    rewriteBeat,
    cutSceneToShots,
    importScript,
    generateSceneImage,
  }
}
