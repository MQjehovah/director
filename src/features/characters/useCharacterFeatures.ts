import { useCharacterStore } from '../../stores/characterStore'
import { useJobStore } from '../../stores/jobStore'
import { usePluginStore } from '../../stores/pluginStore'
import type { Job } from '../../core/models'
import type { LlmFeatureResult } from '../shared/llmResult'
import type { MediaCapabilityProvider } from '../../providers/capabilities'
import { persistGeneratedAssets } from '../shared/persistGeneratedAssets'
import type { AssetResolver } from '../shared/persistGeneratedAssets'

export const CHARACTER_DESCRIPTION_PROMPT =
  '你是一位导演。请根据下面的灵感，生成角色设定（题材不限，可以是写实、动画、科幻、奇幻等任何风格），只返回 JSON（不要任何其他文字），字段：name（简洁的角色名，2-6 个字，符合角色气质与灵感，不含标点）、' +
  'bio（一句话简介）、appearance（尽可能详尽的角色外观描述，覆盖：身高体型、脸型五官、发色发型、瞳色、肤色、' +
  '服装穿搭、配饰、气质神态、标志性特征等，务必足够详细以便直接用于生成角色立绘参考图）、' +
  'tags（字符串数组，2-5 个标签）、' +
  'voice（建议的 TTS 音色标识，如 zh-female，或一句话描述音色）。\n\n灵感：'

export const REFERENCE_PROMPT_EXPANDER =
  '你是一位角色立绘提示词工程师。请根据下面的角色外貌描述，扩写为一段详细、可直接用于 AI 生成角色立绘/参考图的图片生成提示词（使用中文，题材不限，保持角色气质与外观一致性，包含画风、构图、镜头、光影、细节等）。\n\n外貌描述：'

export interface CharacterDescriptionResult {
  ok: boolean
  error?: string
  data?: { name?: string; bio?: string; appearance?: string; tags?: string[]; voice?: string }
}

/** 从 LLM 回复中提取角色设定 JSON；无法解析时返回 undefined */
function parseCharacterJson(
  text: string,
): { name?: string; bio?: string; appearance?: string; tags?: string[]; voice?: string } | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const obj: unknown = JSON.parse(text.slice(start, end + 1))
    if (!obj || typeof obj !== 'object') return undefined
    const record = obj as Record<string, unknown>
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((t): t is string => typeof t === 'string')
      : undefined
    return {
      name: typeof record.name === 'string' ? record.name.trim() : undefined,
      bio: typeof record.bio === 'string' ? record.bio : undefined,
      appearance: typeof record.appearance === 'string' ? record.appearance : undefined,
      tags,
      voice: typeof record.voice === 'string' ? record.voice : undefined,
    }
  } catch {
    return undefined
  }
}

export function useCharacterFeatures() {
  const characterStore = useCharacterStore()
  const jobStore = useJobStore()
  const pluginStore = usePluginStore()

  async function generateCharacterDescription(
    seedIdea: string,
  ): Promise<CharacterDescriptionResult> {
    const llm = pluginStore.llmProvider
    if (!llm) return { ok: false, error: '未配置 LLM Provider，无法生成角色设定。' }
    try {
      const text = await llm.complete(CHARACTER_DESCRIPTION_PROMPT + seedIdea)
      const parsed = parseCharacterJson(text)
      if (parsed) return { ok: true, data: parsed }
      // 非 JSON 回复（旧模型/测试桩）：整体作为详细描述兜底
      return { ok: true, data: { appearance: text.trim() } }
    } catch (err) {
      return { ok: false, error: `角色设定生成失败：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async function expandReferencePrompt(description: string): Promise<LlmFeatureResult> {
    const llm = pluginStore.llmProvider
    if (!llm) return { ok: false, error: '未配置 LLM Provider，无法扩写参考图提示词。' }
    try {
      const text = await llm.complete(REFERENCE_PROMPT_EXPANDER + description)
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: `提示词扩写失败：${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async function generatePortrait(characterId: string): Promise<Job | undefined> {
    const media = pluginStore.resolveInstanceCapability<MediaCapabilityProvider>(
      'media',
      'text2image',
    )
    const character = characterStore.getCharacter(characterId)
    if (!media || !character) return undefined

    // 参考图提示词 = 图片提示词（画风/构图等）+ 详细描述 + 简介 + 标签，文生图能力生成
    const storedPrompt =
      typeof character.metadata?.imagePrompt === 'string'
        ? character.metadata.imagePrompt.trim()
        : ''
    const appearance = character.appearance?.trim() ?? ''
    const bio = character.bio?.trim() ? `角色简介：${character.bio.trim()}` : ''
    const tags = character.tags.length > 0 ? `角色标签：${character.tags.join('、')}` : ''
    const prompt =
      [storedPrompt, appearance, bio, tags].filter(Boolean).join('\n') || character.name

    let providerJob: Job
    try {
      providerJob = await media.generateImage({ prompt, shotRef: undefined })
    } catch (err) {
      throw new Error(`立绘生成失败：${err instanceof Error ? err.message : String(err)}`)
    }
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
      await persistGeneratedAssets(assetIds, media as AssetResolver)
      const current = characterStore.getCharacter(characterId)
      if (current) {
        characterStore.updateCharacter(characterId, {
          referenceImages: [...current.referenceImages, ...assetIds],
        })
      }
    }

    const off = media.onJobUpdate((updated) => {
      if (updated.id !== job.id) return
      jobStore.updateJob(updated)
      if (updated.status === 'done') {
        void applyAsset(updated.result?.assetIds ?? [])
        off()
      } else if (updated.status === 'failed' || updated.status === 'canceled') {
        off()
      }
    })

    // Reconcile: a provider may have completed synchronously before the
    // listener was registered (push/SSE/instant providers).
    try {
      const latest = await media.getJob(job.id)
      if (latest.status === 'done') {
        jobStore.updateJob(latest)
        await applyAsset(latest.result?.assetIds ?? [])
        off()
      } else if (latest.status === 'failed' || latest.status === 'canceled') {
        jobStore.updateJob(latest)
        off()
      }
    } catch {
      // provider may not support getJob for this job; rely on listener
    }

    return job
  }

  return { generateCharacterDescription, expandReferencePrompt, generatePortrait }
}
