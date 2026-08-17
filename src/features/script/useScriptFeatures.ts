import { useCharacterStore } from '../../stores/characterStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import type { Script, Shot } from '../../core/models'
import type { LlmFeatureResult } from '../shared/llmResult'

export const SCRIPT_GENERATION_PROMPT =
  '你是一位动画导演。请根据下面的灵感，用中文创作一份完整的剧本。要求：' +
  '每个场景以 "# 场景标题" 开头；台词使用 "角色名：台词" 格式；动作使用 "动作：描述"；' +
  '音效使用 "音效：描述"。只输出剧本正文，不要任何额外说明。\n\n'

export const BEAT_REWRITE_PROMPT =
  '你是一位动画编剧。请根据下面的改写指令改写给定的叙事节拍。要求：' +
  '对话输出为 "角色名：台词"，动作输出为 "动作：描述"，音效输出为 "音效：描述"。' +
  '只输出改写后的节拍内容，不要任何额外说明。\n\n原始节拍：'

export function useScriptFeatures() {
  const scriptStore = useScriptStore()
  const storyboardStore = useStoryboardStore()
  const pluginStore = usePluginStore()
  const characterStore = useCharacterStore()

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
    const text = await llm.complete(`${SCRIPT_GENERATION_PROMPT}${characterContext()}灵感：${idea}`)
    return { ok: true, text }
  }

  async function rewriteBeat(sceneId: string, beatId: string, instruction: string): Promise<LlmFeatureResult> {
    const llm = pluginStore.llmProvider
    if (!llm) return { ok: false, error: '未配置 LLM Provider，无法改写节拍。' }
    const beatText = serializeBeat(sceneId, beatId)
    if (!beatText) return { ok: false, error: '节拍不存在。' }
    const text = await llm.complete(`${BEAT_REWRITE_PROMPT}${beatText}\n改写指令：${instruction}`)
    return { ok: true, text }
  }

  function cutSceneToShots(sceneId: string): Shot[] {
    const scene = scriptStore.scenes.find((s) => s.id === sceneId)
    if (!scene) return []
    return storyboardStore.cutSceneToShots(scene)
  }

  function importScript(md: string): Script {
    return scriptStore.importMarkdown(md)
  }

  return { generateScriptFromIdea, rewriteBeat, cutSceneToShots, importScript }
}
