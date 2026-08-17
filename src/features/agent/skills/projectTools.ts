import { useScriptStore } from '../../../stores/scriptStore'
import { useCharacterStore } from '../../../stores/characterStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { useScriptFeatures } from '../../script/useScriptFeatures'
import { useCharacterFeatures } from '../../characters/useCharacterFeatures'
import { useShotActions } from '../../storyboard/useShotActions'
import { importWorkflowGraph, saveWorkflowTemplate } from '../../comfyui/workflowStore'
import type { AgentTool, AgentToolResult } from '../core/types'

function failure(name: string, message: string): AgentToolResult {
  return { name, ok: false, summary: message }
}

/**
 * 项目内工具：让 agent 驱动现有 features。工具实际运行时才调用
 * Pinia stores/composables（模块加载时没有激活的 pinia 实例）。
 * 成功摘要中携带 id（场次/镜头/角色），使 agent 能链式调用后续工具。
 */
export function createProjectTools(): AgentTool[] {
  return [
    {
      name: 'generate_script',
      description:
        '根据灵感生成完整剧本并直接导入剧本面板。参数：idea（灵感文本，必填）。成功后可调用 cut_scene 切分场次。',
      async run(args) {
        const idea = (args.idea ?? '').trim()
        if (!idea) return failure('generate_script', '请提供剧本灵感')
        try {
          const features = useScriptFeatures()
          const res = await features.generateScriptFromIdea(idea)
          if (!res.ok) return failure('generate_script', res.error)
          const script = features.importScript(res.text)
          if (script.scenes.length === 0) {
            return failure('generate_script', '生成结果没有可识别的场次')
          }
          const sceneList = script.scenes
            .map((s) => `${s.id}(${s.title || '未命名'})`)
            .join('、')
          return {
            name: 'generate_script',
            ok: true,
            summary: `已生成剧本（${script.scenes.length} 场）：${sceneList}`,
            applyTarget: { kind: 'script' },
          }
        } catch (err) {
          return failure(
            'generate_script',
            `剧本生成失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'cut_scene',
      description:
        '把一个场次切分为分镜镜头（重复切分会重建该场次镜头）。参数：sceneId（场次 id，必填，来自 generate_script 的结果）。',
      async run(args) {
        const sceneId = (args.sceneId ?? '').trim()
        if (!sceneId) return failure('cut_scene', '请提供场次 sceneId')
        try {
          const scriptStore = useScriptStore()
          const scene = scriptStore.scenes.find((s) => s.id === sceneId)
          if (!scene) return failure('cut_scene', `未找到场次「${sceneId}」`)
          if (scene.beats.length === 0) return failure('cut_scene', '该场次没有节拍，无法切分')
          const shots = await useScriptFeatures().cutSceneToShots(sceneId)
          const shotList = shots.map((s) => s.id).join('、')
          return {
            name: 'cut_scene',
            ok: true,
            summary: `已切分为 ${shots.length} 个镜头：${shotList}`,
            applyTarget: { kind: 'shot' },
          }
        } catch (err) {
          return failure(
            'cut_scene',
            `切分失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'create_character',
      description:
        '创建角色（可先用 AI 生成设定卡）。参数：name（角色名，必填）、idea（可选，灵感，触发 AI 生成外貌设定）。',
      async run(args) {
        const name = (args.name ?? '').trim()
        if (!name) return failure('create_character', '请提供角色名 name')
        try {
          const characterStore = useCharacterStore()
          const exists = characterStore.characters.some(
            (c) => c.name.toLowerCase() === name.toLowerCase(),
          )
          if (exists) return failure('create_character', `角色「${name}」已存在`)
          const character = characterStore.addCharacter({ name })
          const idea = (args.idea ?? '').trim()
          if (idea) {
            const res = await useCharacterFeatures().generateCharacterDescription(idea)
            if (res.ok) {
              characterStore.updateCharacter(character.id, { appearance: res.text })
            }
          }
          return {
            name: 'create_character',
            ok: true,
            summary: `已创建角色「${name}」（${character.id}）${idea ? '并生成设定卡' : ''}`,
            applyTarget: { kind: 'portrait', id: character.id },
          }
        } catch (err) {
          return failure(
            'create_character',
            `创建角色失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'generate_portrait',
      description:
        '为已存在的角色生成立绘（按角色名匹配；角色不存在时先调用 create_character）。参数：character（角色名，必填）、style（可选，风格描述）。',
      async run(args) {
        const name = (args.character ?? '').trim()
        const style = (args.style ?? '').trim()
        if (!name) return failure('generate_portrait', '请提供角色名 character')
        try {
          const characterStore = useCharacterStore()
          const character = characterStore.characters.find((c) =>
            c.name.toLowerCase().includes(name.toLowerCase()),
          )
          if (!character) {
            return failure(
              'generate_portrait',
              `未找到角色「${name}」，请先调用 create_character 创建角色`,
            )
          }
          if (style) {
            characterStore.updateCharacter(character.id, {
              metadata: { ...character.metadata, imagePrompt: `角色立绘，风格：${style}` },
            })
          }
          const job = await useCharacterFeatures().generatePortrait(character.id)
          if (!job) return failure('generate_portrait', '未配置媒体 Provider')
          return {
            name: 'generate_portrait',
            ok: true,
            summary: `已为角色「${name}」创建立绘生成任务${style ? `（风格：${style}）` : ''}`,
            applyTarget: { kind: 'portrait', id: character.id },
          }
        } catch (err) {
          return failure(
            'generate_portrait',
            `立绘生成失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'generate_shot_media',
      description:
        '为镜头生成图片或视频媒体。参数：shotId（镜头 id，必填，来自 cut_scene 的结果）。',
      async run(args) {
        const shotId = (args.shotId ?? '').trim()
        if (!shotId) return failure('generate_shot_media', '请提供镜头 shotId')
        try {
          const storyboardStore = useStoryboardStore()
          if (!storyboardStore.shotById(shotId)) {
            return failure('generate_shot_media', `未找到镜头「${shotId}」`)
          }
          const job = await useShotActions().generateMedia(shotId)
          if (!job) return failure('generate_shot_media', '未配置媒体 Provider')
          return {
            name: 'generate_shot_media',
            ok: true,
            summary: '已创建镜头媒体生成任务',
            applyTarget: { kind: 'shot', id: shotId },
          }
        } catch (err) {
          return failure(
            'generate_shot_media',
            `媒体生成失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'expand_prompt',
      description:
        '把简短描述扩写为可直接用于生成立绘/参考图的图片提示词。参数：text（描述，必填）、style（可选，风格描述）。',
      async run(args) {
        const text = (args.text ?? args.prompt ?? '').trim()
        const style = (args.style ?? '').trim()
        if (!text) return failure('expand_prompt', '请提供待扩写的文本 text')
        try {
          const res = await useCharacterFeatures().expandReferencePrompt(
            style ? `${text}，风格：${style}` : text,
          )
          if (!res.ok) return failure('expand_prompt', res.error)
          return {
            name: 'expand_prompt',
            ok: true,
            summary: `已生成扩写提示词${style ? `（风格：${style}）` : ''}`,
            applyTarget: { kind: 'prompt', text: res.text },
          }
        } catch (err) {
          return failure(
            'expand_prompt',
            `提示词扩写失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
    {
      name: 'import_workflow',
      description:
        '导入 ComfyUI 工作流模板并识别正负提示词与种子节点。参数：graphJson（工作流 JSON，必填）、name（可选，模板名）。',
      async run(args) {
        const graphJson = (args.graphJson ?? '').trim()
        if (!graphJson) return failure('import_workflow', '请提供工作流 JSON graphJson')
        const name = (args.name ?? '').trim() || '未命名工作流'
        try {
          const tpl = importWorkflowGraph(graphJson, name)
          if ('error' in tpl) return failure('import_workflow', tpl.error)
          saveWorkflowTemplate(tpl)
          return {
            name: 'import_workflow',
            ok: true,
            summary: `已导入工作流「${tpl.name}」（${tpl.id}）并识别节点`,
            applyTarget: { kind: 'workflow', id: tpl.id },
          }
        } catch (err) {
          return failure(
            'import_workflow',
            `工作流导入失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
  ]
}
