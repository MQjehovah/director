import { useScriptFeatures } from '../script/useScriptFeatures'
import { useCharacterFeatures } from '../characters/useCharacterFeatures'
import { useShotActions } from '../storyboard/useShotActions'
import { useScriptStore } from '../../stores/scriptStore'
import { useCharacterStore } from '../../stores/characterStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useJobStore } from '../../stores/jobStore'
import { usePluginStore } from '../../stores/pluginStore'
import { beatDialogueForShot } from '../player/subtitles'
import type { PipelineStep } from './PipelineRunner'

export interface ScriptStepResult {
  scriptId: string
  sceneCount: number
}

export interface CutStepResult {
  shotCount: number
  shotIds: string[]
}

export interface PortraitStepResult {
  portraitCount: number
  jobIds: string[]
}

export interface SceneArtStepResult {
  sceneCount: number
  jobIds: string[]
}

export interface RenderStepResult {
  renderCount: number
  jobIds: string[]
}

export interface VoiceStepResult {
  voiceCount: number
  jobIds: string[]
}

export interface AssembleStepResult {
  sceneCount: number
  shotCount: number
  doneJobCount: number
}

export function scriptStep(): PipelineStep<ScriptStepResult> {
  return {
    id: 'script',
    title: '生成剧本',
    enabled: true,
    async run(ctx) {
      const idea = typeof ctx.input === 'string' ? ctx.input.trim() : ''
      if (!idea) {
        ctx.fail('script', '缺少故事梗概，无法生成剧本。')
        return
      }
      const features = useScriptFeatures()
      const res = await features.generateScriptFromIdea(idea)
      if (!res.ok) {
        ctx.fail('script', res.error)
        return
      }
      const script = features.importScript(res.text)
      if (script.scenes.length === 0) {
        ctx.fail('script', '生成结果没有可识别的场次。')
        return
      }
      return { scriptId: script.id, sceneCount: script.scenes.length }
    },
  }
}

export function cutStep(): PipelineStep<CutStepResult> {
  return {
    id: 'cut',
    title: '切分镜头',
    enabled: true,
    async run(ctx) {
      const scriptStore = useScriptStore()
      const storyboardStore = useStoryboardStore()
      const features = useScriptFeatures()
      if (scriptStore.scenes.length === 0) {
        ctx.fail('cut', '没有可切分的场次，请先生成剧本。')
        return
      }
      const shotIds: string[] = []
      for (const scene of scriptStore.scenes) {
        // 已切分的场景跳过，避免重建镜头时清空已生成的媒体资产
        const beatIds = new Set(scene.beats.map((b) => b.id))
        const hasShots = storyboardStore.shots.some((s) => s.beatRef && beatIds.has(s.beatRef))
        if (hasShots) continue
        const shots = await features.cutSceneToShots(scene.id)
        shotIds.push(...shots.map((s) => s.id))
      }
      return { shotCount: shotIds.length, shotIds }
    },
  }
}

export function portraitStep(): PipelineStep<PortraitStepResult> {
  return {
    id: 'portrait',
    title: '生成角色立绘',
    enabled: true,
    async run(ctx) {
      const characterStore = useCharacterStore()
      if (characterStore.characters.length === 0) {
        return { portraitCount: 0, jobIds: [] }
      }
      const pluginStore = usePluginStore()
      if (!pluginStore.mediaProvider) {
        ctx.fail('portrait', '未配置媒体 Provider，无法生成角色立绘。')
        return
      }
      const features = useCharacterFeatures()
      const jobIds: string[] = []
      for (const character of characterStore.characters) {
        try {
          const job = await features.generatePortrait(character.id)
          if (job) jobIds.push(job.id)
        } catch (err) {
          ctx.fail('portrait', err instanceof Error ? err.message : String(err))
          return
        }
      }
      return { portraitCount: jobIds.length, jobIds }
    },
  }
}

export function sceneArtStep(): PipelineStep<SceneArtStepResult> {
  return {
    id: 'scene-art',
    title: '生成场景图',
    enabled: true,
    async run(ctx) {
      const scriptStore = useScriptStore()
      if (scriptStore.scenes.length === 0) {
        return { sceneCount: 0, jobIds: [] }
      }
      const pluginStore = usePluginStore()
      if (!pluginStore.mediaProvider) {
        ctx.fail('scene-art', '未配置媒体 Provider，无法生成场景图。')
        return
      }
      const features = useScriptFeatures()
      const jobIds: string[] = []
      let sceneCount = 0
      for (const scene of scriptStore.scenes) {
        if (scene.sceneImage) continue
        try {
          const job = await features.generateSceneImage(scene.id)
          if (job) {
            sceneCount += 1
            jobIds.push(job.id)
          }
        } catch (err) {
          ctx.fail('scene-art', err instanceof Error ? err.message : String(err))
          return
        }
      }
      return { sceneCount, jobIds }
    },
  }
}

export function renderStep(): PipelineStep<RenderStepResult> {
  return {
    id: 'render',
    title: '生成画面',
    enabled: true,
    async run(ctx) {
      const storyboardStore = useStoryboardStore()
      if (storyboardStore.shots.length === 0) {
        ctx.fail('render', '没有待生成的镜头，请先切分镜头。')
        return
      }
      const pluginStore = usePluginStore()
      if (!pluginStore.mediaProvider) {
        ctx.fail('render', '未配置媒体 Provider，无法生成画面。')
        return
      }
      const actions = useShotActions()
      const jobIds: string[] = []
      for (const shot of storyboardStore.shots) {
        if (shot.mediaAssets.length > 0) continue
        try {
          const job = await actions.generateMedia(shot.id)
          if (job) jobIds.push(job.id)
        } catch (err) {
          ctx.fail('render', err instanceof Error ? err.message : String(err))
          return
        }
      }
      return { renderCount: jobIds.length, jobIds }
    },
  }
}

export function voiceStep(): PipelineStep<VoiceStepResult> {
  return {
    id: 'voice',
    title: '配音',
    enabled: true,
    async run(ctx) {
      const pluginStore = usePluginStore()
      const storyboardStore = useStoryboardStore()
      const scriptStore = useScriptStore()
      if (!pluginStore.ttsProvider) {
        ctx.fail('voice', '未配置 TTS Provider，无法配音。')
        return
      }
      const jobStore = useJobStore()
      const jobIds: string[] = []
      for (const shot of storyboardStore.shots) {
        const dialogue = beatDialogueForShot(scriptStore.script, shot)
        if (!dialogue) continue
        try {
          const job = await pluginStore.ttsProvider.synthesize(dialogue)
          jobIds.push(job.id)
          jobStore.addJob({
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            pluginId: job.pluginId,
            shotRef: shot.id,
            params: job.params,
            result: job.result,
          })
        } catch (err) {
          ctx.fail('voice', err instanceof Error ? err.message : String(err))
          return
        }
      }
      return { voiceCount: jobIds.length, jobIds }
    },
  }
}

export function assembleStep(): PipelineStep<AssembleStepResult> {  return {
    id: 'assemble',
    title: '组装成片',
    enabled: true,
    async run() {
      const scriptStore = useScriptStore()
      const storyboardStore = useStoryboardStore()
      const jobStore = useJobStore()
      return {
        sceneCount: scriptStore.scenes.length,
        shotCount: storyboardStore.shots.length,
        doneJobCount: jobStore.jobs.filter((j) => j.status === 'done').length,
      }
    },
  }
}

export function presetPipeline(): PipelineStep[] {
  return [
    scriptStep(),
    cutStep(),
    sceneArtStep(),
    portraitStep(),
    renderStep(),
    voiceStep(),
    assembleStep(),
  ]
}
