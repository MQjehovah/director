import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createProjectTools } from '../projectTools'
import { useScriptStore } from '../../../../stores/scriptStore'
import { useStoryboardStore } from '../../../../stores/storyboardStore'
import { useCharacterStore } from '../../../../stores/characterStore'
import { useJobStore } from '../../../../stores/jobStore'
import { usePluginStore } from '../../../../stores/pluginStore'
import { PluginRegistry } from '../../../../core'
import {
  createStubLLMPlugin,
  createStubMediaPlugin,
} from '../../../shared/__tests__/stubProviders'
import { listWorkflowTemplates } from '../../../comfyui/workflowStore'
import type { AgentTool } from '../../core/types'

function initProviders(types: Array<'llm' | 'media'>): void {
  const registry = new PluginRegistry()
  if (types.includes('llm')) registry.register(createStubLLMPlugin())
  if (types.includes('media')) registry.register(createStubMediaPlugin())
  usePluginStore().init(registry)
}

function tool(name: string): AgentTool {
  const t = createProjectTools().find((x) => x.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe('createProjectTools', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the seven project tools with Chinese descriptions', () => {
    const names = createProjectTools().map((t) => t.name)
    expect(names).toEqual([
      'generate_script',
      'cut_scene',
      'create_character',
      'generate_portrait',
      'generate_shot_media',
      'expand_prompt',
      'import_workflow',
    ])
    for (const t of createProjectTools()) {
      expect(t.description.length).toBeGreaterThan(0)
    }
  })

  describe('generate_script', () => {
    it('creates scenes in the script store on ok', async () => {
      initProviders(['llm'])
      const res = await tool('generate_script').run({ idea: '都市少年' })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.summary).toContain('已生成剧本')
        expect(res.summary).toMatch(/场/)
        expect(res.applyTarget).toEqual({ kind: 'script' })
        expect(useScriptStore().scenes.length).toBeGreaterThan(0)
      }
    })

    it('fails when idea is empty', async () => {
      const res = await tool('generate_script').run({ idea: '  ' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('请提供剧本灵感')
    })

    it('surfaces the error when no LLM is registered', async () => {
      const res = await tool('generate_script').run({ idea: '都市少年' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未配置')
    })
  })

  describe('cut_scene', () => {
    it('creates shots for a scene with beats', async () => {
      const script = useScriptStore()
      const storyboard = useStoryboardStore()
      const scene = script.addScene({ title: '屋顶' })
      script.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
      script.addBeat(scene.id, { type: 'action', action: '小明招手' })
      const res = await tool('cut_scene').run({ sceneId: scene.id })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.summary).toContain('已切分为 2 个镜头')
        expect(res.applyTarget).toEqual({ kind: 'shot' })
        expect(storyboard.shots).toHaveLength(2)
      }
    })

    it('fails on a missing scene', async () => {
      const res = await tool('cut_scene').run({ sceneId: 'missing-scene' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未找到场次')
    })

    it('fails when the scene has no beats', async () => {
      const scene = useScriptStore().addScene({ title: '空场' })
      const res = await tool('cut_scene').run({ sceneId: scene.id })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('没有节拍')
    })
  })

  describe('generate_portrait', () => {
    it('finds a character by name and creates a job', async () => {
      initProviders(['media'])
      const characters = useCharacterStore()
      const char = characters.addCharacter({ name: '小明', appearance: '银发少年' })
      const res = await tool('generate_portrait').run({ character: '小' })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.summary).toContain('创建立绘生成任务')
        expect(res.applyTarget).toEqual({ kind: 'portrait', id: char.id })
        expect(useJobStore().jobs.length).toBeGreaterThan(0)
      }
    })

    it('sets imagePrompt from the style argument', async () => {
      initProviders(['media'])
      const characters = useCharacterStore()
      const char = characters.addCharacter({ name: '小红' })
      const res = await tool('generate_portrait').run({ character: '小红', style: '动漫' })
      expect(res.ok).toBe(true)
      const updated = characters.getCharacter(char.id)
      expect(String(updated?.metadata?.imagePrompt ?? '')).toContain('动漫')
    })

    it('fails when the character is not found', async () => {
      initProviders(['media'])
      const res = await tool('generate_portrait').run({ character: '不存在' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未找到角色')
    })

    it('fails when no media provider is registered', async () => {
      useCharacterStore().addCharacter({ name: '小明' })
      const res = await tool('generate_portrait').run({ character: '小明' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未配置媒体 Provider')
    })
  })

  describe('generate_shot_media', () => {
    it('creates a job for an existing shot', async () => {
      initProviders(['media'])
      const storyboard = useStoryboardStore()
      const shot = storyboard.addShot({ shotType: 'image', prompt: '屋顶上的少年' })
      const res = await tool('generate_shot_media').run({ shotId: shot.id })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.summary).toContain('已创建镜头媒体生成任务')
        expect(res.applyTarget).toEqual({ kind: 'shot', id: shot.id })
        expect(useJobStore().jobs.length).toBeGreaterThan(0)
      }
    })

    it('fails on a missing shot', async () => {
      initProviders(['media'])
      const res = await tool('generate_shot_media').run({ shotId: 'missing-shot' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未找到镜头')
    })

    it('fails when no media provider is registered', async () => {
      const storyboard = useStoryboardStore()
      const shot = storyboard.addShot({ shotType: 'image', prompt: 'x' })
      const res = await tool('generate_shot_media').run({ shotId: shot.id })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未配置媒体 Provider')
    })
  })

  describe('expand_prompt', () => {
    it('returns the expanded prompt as an apply target', async () => {
      initProviders(['llm'])
      const res = await tool('expand_prompt').run({ text: '银发剑士' })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.summary).toContain('已生成扩写提示词')
        expect(res.applyTarget?.kind).toBe('prompt')
        expect(res.applyTarget?.text).toContain('Mock 回复')
        expect(res.applyTarget?.text).toContain('银发剑士')
      }
    })

    it('fails when the text is empty', async () => {
      const res = await tool('expand_prompt').run({ text: '' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('请提供')
    })

    it('fails when no LLM is registered', async () => {
      const res = await tool('expand_prompt').run({ text: '银发剑士' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('未配置')
    })
  })

  describe('import_workflow', () => {
    const GRAPH = JSON.stringify({ '3': { class_type: 'KSampler', inputs: { seed: 1 } } })

    it('imports the workflow and saves a template', async () => {
      const res = await tool('import_workflow').run({ name: '我的工作流', graphJson: GRAPH })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.summary).toContain('已导入工作流「我的工作流」')
        expect(res.applyTarget?.kind).toBe('workflow')
        const templates = listWorkflowTemplates()
        expect(templates).toHaveLength(1)
        expect(templates[0].id).toBe(res.applyTarget?.id)
        expect(templates[0].name).toBe('我的工作流')
      }
    })

    it('defaults the name to 未命名工作流', async () => {
      const res = await tool('import_workflow').run({ graphJson: GRAPH })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.summary).toContain('未命名工作流')
    })

    it('converts a UI-format workflow (nodes) to API format before importing', async () => {
      const ui = JSON.stringify({
        nodes: [
          {
            id: 3,
            type: 'KSampler',
            mode: 0,
            inputs: [],
            widgets_values: [42, true, 20, 8, 'euler', 'normal', 1],
            outputs: [],
          },
        ],
        links: [],
      })
      const res = await tool('import_workflow').run({ name: '前端格式', graphJson: ui })
      expect(res.ok).toBe(true)
      const templates = listWorkflowTemplates()
      expect(templates).toHaveLength(1)
      const saved = JSON.parse(templates[0].graphJson) as Record<
        string,
        { inputs: Record<string, unknown> }
      >
      expect(saved['3'].inputs.seed).toBe(42)
      expect(templates[0].seedNodeId).toBe('3')
    })

    it('fails on invalid JSON', async () => {
      const res = await tool('import_workflow').run({ name: 'x', graphJson: '{oops' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('解析失败')
    })

    it('fails when graphJson is missing', async () => {
      const res = await tool('import_workflow').run({ name: 'x' })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.summary).toContain('请提供工作流 JSON')
    })
  })

  it('every tool run returns ok:false (never throws) under missing args', async () => {
    const cases: Array<[string, Record<string, string>]> = [
      ['generate_script', {}],
      ['cut_scene', {}],
      ['create_character', {}],
      ['generate_portrait', {}],
      ['generate_shot_media', {}],
      ['expand_prompt', {}],
      ['import_workflow', {}],
    ]
    for (const [name, args] of cases) {
      const t = createProjectTools().find((x) => x.name === name)
      expect(t).toBeDefined()
      const res = await t!.run(args)
      expect(res.ok).toBe(false)
      expect(res.summary.length).toBeGreaterThan(0)
    }
  })

  it('create_character creates a character and returns its id', async () => {
    const res = await tool('create_character').run({ name: '小红', idea: '活泼少女' })
    expect(res.ok).toBe(true)
    const char = useCharacterStore().characters[0]
    expect(char?.name).toBe('小红')
    expect(res.applyTarget).toMatchObject({ kind: 'portrait', id: char?.id })
  })

  it('create_character rejects a duplicate name', async () => {
    useCharacterStore().addCharacter({ name: '小红' })
    const res = await tool('create_character').run({ name: '小红' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.summary).toContain('已存在')
  })

  it('generate_script summary includes scene ids for chaining', async () => {
    initProviders(['llm'])
    const res = await tool('generate_script').run({ idea: '都市少年' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.summary).toMatch(/scene-\d+/)
  })

  it('cut_scene summary includes shot ids', async () => {
    const scriptStore = useScriptStore()
    const scene = scriptStore.addScene({ title: '屋顶' })
    scriptStore.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: 'A', text: 'hi' } })
    const res = await tool('cut_scene').run({ sceneId: scene.id })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.summary).toMatch(/shot-\d+/)
  })

  it('cut_scene reports clearly when the scene has no beats', async () => {
    const scene = useScriptStore().addScene({ title: '空场' })
    const res = await tool('cut_scene').run({ sceneId: scene.id })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.summary).toContain('没有节拍')
  })

  it('generate_shot_media distinguishes missing shot from missing media', async () => {
    const res = await tool('generate_shot_media').run({ shotId: 'nope' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.summary).toContain('未找到镜头')
  })

  it('expand_prompt honors a style argument', async () => {
    initProviders(['llm'])
    const res = await tool('expand_prompt').run({ text: '银发剑士', style: '<anime>' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.summary).toContain('<anime>')
      expect(res.applyTarget).toMatchObject({ kind: 'prompt' })
    }
  })
})
