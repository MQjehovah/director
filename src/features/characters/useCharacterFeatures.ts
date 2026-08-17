import { useCharacterStore } from '../../stores/characterStore'
import { useJobStore } from '../../stores/jobStore'
import { usePluginStore } from '../../stores/pluginStore'
import type { Job } from '../../core/models'
import type { LlmFeatureResult } from '../shared/llmResult'

export const CHARACTER_DESCRIPTION_PROMPT =
  '你是一位动画导演。请根据下面的灵感，生成一份结构化的角色设定卡片（使用中文），内容包含：外貌、性格、背景。请分条列出。\n\n灵感：'

export const REFERENCE_PROMPT_EXPANDER =
  '你是一位动漫立绘提示词工程师。请根据下面的角色外貌描述，扩写为一段详细、可直接用于 AI 生成角色立绘/参考图的图片生成提示词（使用中文，包含画风、构图、镜头、光影、细节等）。\n\n外貌描述：'

export function useCharacterFeatures() {
  const characterStore = useCharacterStore()
  const jobStore = useJobStore()
  const pluginStore = usePluginStore()

  async function generateCharacterDescription(seedIdea: string): Promise<LlmFeatureResult> {
    const llm = pluginStore.llmProvider
    if (!llm) return { ok: false, error: '未配置 LLM Provider，无法生成角色设定。' }
    try {
      const text = await llm.complete(CHARACTER_DESCRIPTION_PROMPT + seedIdea)
      return { ok: true, text }
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
    const media = pluginStore.mediaProvider
    const character = characterStore.getCharacter(characterId)
    if (!media || !character) return undefined

    const storedPrompt = character.metadata?.imagePrompt
    const prompt =
      typeof storedPrompt === 'string' && storedPrompt.trim().length > 0
        ? storedPrompt
        : (character.appearance?.trim() || character.name)

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

    const off = media.onJobUpdate((updated) => {
      if (updated.id !== job.id) return
      jobStore.updateJob(updated)
      if (updated.status === 'done') {
        const assetIds = updated.result?.assetIds ?? []
        if (assetIds.length > 0) {
          const current = characterStore.getCharacter(characterId)
          if (current) {
            characterStore.updateCharacter(characterId, {
              referenceImages: [...current.referenceImages, ...assetIds],
            })
          }
        }
        off()
      } else if (updated.status === 'failed' || updated.status === 'canceled') {
        off()
      }
    })

    return job
  }

  return { generateCharacterDescription, expandReferencePrompt, generatePortrait }
}
