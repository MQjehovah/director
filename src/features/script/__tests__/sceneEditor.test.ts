import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import BeatList from '../BeatList.vue'
import SceneEditor from '../SceneEditor.vue'
import ScriptPanel from '../ScriptPanel.vue'
import { useScriptStore } from '../../../stores/scriptStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useScriptFeatures } from '../useScriptFeatures'
import { PluginRegistry } from '../../../core'
import { createLLMMockPlugin } from '../../../plugins/providers'

function initProviders(types: Array<'llm'>): void {
  const registry = new PluginRegistry()
  if (types.includes('llm')) registry.register(createLLMMockPlugin())
  usePluginStore().init(registry)
}

describe('beat list', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders dialogue beats and edits text', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    expect(w.text()).toContain('小明')
    expect(w.get<HTMLInputElement>('[data-test="beat-text"]').element.value).toBe('你好')
    await w.get('[data-test="beat-text"]').setValue('你好呀')
    expect(store.scenes[0].beats[0].dialogue?.text).toBe('你好呀')
  })

  it('renders action and sfx beats with badges', () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'action', action: '小红跑上屋顶' })
    store.addBeat(scene.id, { type: 'sfx', action: '远处雷声' })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    const actions = w.findAll('[data-test="beat-action"]')
    expect(actions).toHaveLength(2)
    expect((actions[0].element as HTMLTextAreaElement).value).toBe('小红跑上屋顶')
    expect((actions[1].element as HTMLTextAreaElement).value).toBe('远处雷声')
    const badges = w.findAll('[data-test="beat-type"]').map((n) => n.text())
    expect(badges).toContain('动作')
    expect(badges).toContain('音效')
  })

  it('adds beats of each type and removes one', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="new-type"]').setValue('dialogue')
    await w.get('[data-test="beat-add"]').trigger('click')
    await w.get('[data-test="new-type"]').setValue('action')
    await w.get('[data-test="beat-add"]').trigger('click')
    await w.get('[data-test="new-type"]').setValue('sfx')
    await w.get('[data-test="beat-add"]').trigger('click')
    expect(store.scenes[0].beats).toHaveLength(3)
    expect(store.scenes[0].beats.map((b) => b.type)).toEqual(['dialogue', 'action', 'sfx'])
    await w.get('[data-test="beat-remove"]').trigger('click')
    expect(store.scenes[0].beats.map((b) => b.type)).toEqual(['action', 'sfx'])
  })

  it('AI 改写 updates the beat when LLM is available', async () => {
    initProviders(['llm'])
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="rewrite-instruction"]').setValue('更有气势')
    await w.get('[data-test="beat-rewrite"]').trigger('click')
    await flushPromises()
    expect(store.scenes[0].beats[0].dialogue?.speaker).toBe('Mock 回复')
  })

  it('AI 改写 shows a message when LLM is missing', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="rewrite-instruction"]').setValue('更有气势')
    await w.get('[data-test="beat-rewrite"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="message"]').text()).toContain('未配置')
  })
})

describe('scene editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates scene title and location', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="scene-title"]').setValue('雨夜')
    await w.get('[data-test="scene-location"]').setValue('天台')
    expect(store.scenes[0].title).toBe('雨夜')
    expect(store.scenes[0].location).toBe('天台')
  })
})

describe('script panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('imports markdown into scenes and selects the first scene', async () => {
    const store = useScriptStore()
    const w = mount(ScriptPanel)
    await w.get('[data-test="markdown-input"]').setValue('# 第一场：屋顶\n\n小明：你好\n动作：招手\n')
    await w.get('[data-test="import-btn"]').trigger('click')
    expect(store.scenes).toHaveLength(1)
    expect(store.scenes[0].title).toBe('第一场：屋顶')
    expect(store.scenes[0].beats).toHaveLength(2)
    expect(w.get('[data-test="scene-title"]')).toBeTruthy()
  })

  it('AI 生成剧本 reports an error when LLM is missing', async () => {
    const w = mount(ScriptPanel)
    await w.get('[data-test="idea-input"]').setValue('都市少年')
    await w.get('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="message"]').text()).toContain('未配置')
  })

  it('AI 生成剧本 imports the generated script when LLM is available', async () => {
    initProviders(['llm'])
    const store = useScriptStore()
    const w = mount(ScriptPanel)
    await w.get('[data-test="idea-input"]').setValue('都市少年')
    await w.get('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(store.scenes.length).toBeGreaterThan(0)
    expect(w.get('[data-test="message"]').text()).toContain('已生成')
  })

  it('一键切分为镜头 creates one shot per beat', async () => {
    const store = useScriptStore()
    const storyboard = useStoryboardStore()
    const scene = store.addScene({ title: '屋顶' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    store.addBeat(scene.id, { type: 'action', action: '小明招手' })
    const w = mount(ScriptPanel)
    await w.get('[data-test="scene-item"]').trigger('click')
    await w.get('[data-test="cut-btn"]').trigger('click')
    expect(storyboard.shots).toHaveLength(2)
    expect(storyboard.shots.map((s) => s.beatRef)).toEqual(
      store.scenes[0].beats.map((b) => b.id),
    )
    expect(w.get('[data-test="message"]').text()).toContain('已切分')
  })
})

describe('useScriptFeatures', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generateScriptFromIdea returns text when LLM is available', async () => {
    initProviders(['llm'])
    const res = await useScriptFeatures().generateScriptFromIdea('都市少年')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text).toContain('都市少年')
  })

  it('generateScriptFromIdea reports an error when LLM is missing', async () => {
    const res = await useScriptFeatures().generateScriptFromIdea('都市少年')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
  })

  it('rewriteBeat rewrites a beat when LLM is available', async () => {
    initProviders(['llm'])
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const beat = store.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    const res = await useScriptFeatures().rewriteBeat(scene.id, beat.id, '更有气势')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text.length).toBeGreaterThan(0)
  })

  it('rewriteBeat reports an error when LLM is missing', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const beat = store.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    const res = await useScriptFeatures().rewriteBeat(scene.id, beat.id, '更有气势')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
  })

  it('rewriteBeat reports an error when the beat does not exist', async () => {
    initProviders(['llm'])
    const res = await useScriptFeatures().rewriteBeat('missing-scene', 'missing-beat', 'x')
    expect(res.ok).toBe(false)
  })

  it('cutSceneToShots creates shots for every beat', () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    store.addBeat(scene.id, { type: 'action', action: '小明招手' })
    const shots = useScriptFeatures().cutSceneToShots(scene.id)
    expect(shots).toHaveLength(2)
    expect(useStoryboardStore().shots).toHaveLength(2)
  })

  it('cutSceneToShots returns an empty list for a missing scene', () => {
    expect(useScriptFeatures().cutSceneToShots('missing')).toEqual([])
  })

  it('importScript parses markdown into a script', () => {
    const script = useScriptFeatures().importScript('# 第一场：屋顶\n\n小明：你好\n动作：招手\n')
    expect(script.scenes).toHaveLength(1)
    expect(script.scenes[0].beats).toHaveLength(2)
    expect(useScriptStore().script?.scenes).toHaveLength(1)
  })
})
