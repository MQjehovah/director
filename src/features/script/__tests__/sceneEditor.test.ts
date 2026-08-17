import { flushPromises, mount, DOMWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import BeatList from '../BeatList.vue'
import SceneEditor from '../SceneEditor.vue'
import ScriptPanel from '../ScriptPanel.vue'
import { useScriptStore } from '../../../stores/scriptStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { useCharacterStore } from '../../../stores/characterStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useJobStore } from '../../../stores/jobStore'
import { buildScenePrompt, useScriptFeatures } from '../useScriptFeatures'
import { PluginRegistry } from '../../../core'
import type { Asset } from '../../../core/models'
import { createStubLLMPlugin, createStubMediaPlugin } from '../../shared/__tests__/stubProviders'

function initProviders(types: Array<'llm'>): void {
  const registry = new PluginRegistry()
  if (types.includes('llm')) registry.register(createStubLLMPlugin())
  usePluginStore().init(registry)
}

function initMedia(delayMs = 30): void {
  const registry = new PluginRegistry()
  registry.register(createStubMediaPlugin({ delayMs }))
  usePluginStore().init(registry)
}

function initMediaWithStorage(): Asset[] {
  const registry = new PluginRegistry()
  registry.register(createStubMediaPlugin({ delayMs: 30 }))
  const savedRecords: Asset[] = []
  registry.register({
    id: 'storage-inline',
    name: 'Inline Storage',
    kind: 'provider',
    providerType: 'storage',
    enabled: true,
    instance: {
      id: 'storage-inline',
      name: 'Inline Storage',
      async saveAssetRecord(asset: Asset) {
        savedRecords.push(asset)
      },
      async loadAsset(id: string) {
        return savedRecords.find((r) => r.id === id)
      },
      async getAssetUrl(asset: Asset) {
        return asset.url
      },
    },
  })
  usePluginStore().init(registry)
  return savedRecords
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** AI 辅助在 Dialog（Teleport 到 body），先点 ✨ 打开再从 body 查 */
async function openAi(w: ReturnType<typeof mount>): Promise<void> {
  await w.get('[data-test="ai-btn"]').trigger('click')
}

function inDialog(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector)
  if (!el) throw new Error(`dialog element not found: ${selector}`)
  return new DOMWrapper(el)
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
    expect(w.get<HTMLInputElement>('[data-test="beat-speaker"]').element.value).toBe('小明')
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

  it('adds beats then switches each type and removes one', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="beat-add"]').trigger('click')
    await w.get('[data-test="beat-add"]').trigger('click')
    await w.get('[data-test="beat-add"]').trigger('click')
    expect(store.scenes[0].beats).toHaveLength(3)
    expect(store.scenes[0].beats.every((b) => b.type === 'dialogue')).toBe(true)
    const selects = w.findAll('[data-test="beat-type-select"]')
    await selects[1].setValue('action')
    await selects[2].setValue('sfx')
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
    await w.get('[data-test="beat-rewrite"]').trigger('click')
    await w.get('[data-test="rewrite-instruction"]').setValue('更有气势')
    await w.get('[data-test="rewrite-apply"]').trigger('click')
    await flushPromises()
    expect(store.scenes[0].beats[0].dialogue?.speaker).toBe('Mock 回复')
  })

  it('AI 改写 shows a message when LLM is missing', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="beat-rewrite"]').trigger('click')
    await w.get('[data-test="rewrite-instruction"]').setValue('更有气势')
    await w.get('[data-test="rewrite-apply"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="rewrite-message"]').text()).toContain('未配置')
  })

  it('clearing the speaker does not crash', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="beat-speaker"]').setValue('')
    expect(store.scenes[0].beats[0].dialogue?.speaker).toBe('')
  })

  it('offers character names as speaker suggestions and still allows free text', async () => {
    const scriptStore = useScriptStore()
    const characterStore = useCharacterStore()
    characterStore.addCharacter({ name: '小明' })
    characterStore.addCharacter({ name: '小红' })
    const scene = scriptStore.addScene({ title: '开场' })
    scriptStore.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '角色', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    const suggestions = w
      .findAll('#beat-character-names option')
      .map((o) => o.attributes('value'))
    expect(suggestions).toEqual(expect.arrayContaining(['小明', '小红']))
    await w.get('[data-test="beat-speaker"]').setValue('路人甲')
    expect(scriptStore.scenes[0].beats[0].dialogue?.speaker).toBe('路人甲')
  })

  it('AI 改写 parses multi-line rewrite output into dialogue text', async () => {
    setActivePinia(createPinia())
    const registry = new PluginRegistry()
    registry.register({
      id: 'llm-multiline',
      name: 'Multiline LLM',
      kind: 'provider',
      providerType: 'llm',
      enabled: true,
      instance: {
        id: 'llm-multiline',
        name: 'Multiline LLM',
        models: [],
        chat: async function* () {
          yield '小明：你给我站住！\n小红：凭什么？'
        },
        complete: async () => '小明：你给我站住！\n小红：凭什么？',
      },
    })
    usePluginStore().init(registry)
    const store = useScriptStore()
    const scene = store.addScene({ title: '开场' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: scene.id } })
    await w.get('[data-test="beat-rewrite"]').trigger('click')
    await w.get('[data-test="rewrite-instruction"]').setValue('更有气势')
    await w.get('[data-test="rewrite-apply"]').trigger('click')
    await flushPromises()
    const beat = store.scenes[0].beats[0]
    expect(beat.type).toBe('dialogue')
    expect(beat.dialogue?.speaker).toBe('小明')
    expect(beat.dialogue?.text).toContain('你给我站住')
    expect(beat.dialogue?.text).toContain('凭什么')
  })
})

describe('scene editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates the scene title', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="scene-title"]').setValue('雨夜')
    expect(store.scenes[0].title).toBe('雨夜')
  })

  it('edits the scene description', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="scene-description"]').setValue('破败的天台，傍晚橘色光线')
    expect(store.scenes[0].description).toBe('破败的天台，傍晚橘色光线')
  })

  it('generates a scene image via img2img when a reference image exists', async () => {
    initMedia()
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶', location: '屋顶', timeOfDay: '夜景' })
    store.updateScene(scene.id, { referenceImages: ['https://example.com/ref.png'] })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="gen-scene-image"]').trigger('click')
    await flushPromises()
    await wait(100)
    expect(store.scenes.find((s) => s.id === scene.id)?.sceneImage).toBeDefined()
    expect(useJobStore().jobs.some((j) => j.type === 'editImage')).toBe(true)
  })

  it('falls back to text2image for scene generation without a reference image', async () => {
    initMedia()
    const store = useScriptStore()
    const scene = store.addScene({ title: '森林', location: '森林' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="gen-scene-image"]').trigger('click')
    await flushPromises()
    await wait(100)
    expect(useJobStore().jobs.some((j) => j.type === 'text2image')).toBe(true)
    expect(store.scenes.find((s) => s.id === scene.id)?.sceneImage).toBeDefined()
  })

  it('shows a message when no media provider is configured', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="gen-scene-image"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="scene-message"]').text()).toContain('未配置')
  })

  it('forces text2image when the scene art mode is 文生图 even with a reference image', async () => {
    initMedia()
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶', artMode: 'text2image' })
    store.updateScene(scene.id, { referenceImages: ['https://example.com/ref.png'] })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="gen-scene-image"]').trigger('click')
    await flushPromises()
    await wait(100)
    expect(useJobStore().jobs.some((j) => j.type === 'text2image')).toBe(true)
    expect(useJobStore().jobs.some((j) => j.type === 'editImage')).toBe(false)
    expect(store.scenes.find((s) => s.id === scene.id)?.sceneImage).toBeDefined()
  })

  it('reports a clear error when 图生图 mode has no reference image', async () => {
    initMedia()
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶', artMode: 'img2img' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="gen-scene-image"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="scene-message"]').text()).toContain('参考图')
  })

  it('switches the scene art mode via the select', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="scene-art-mode"]').setValue('img2img')
    expect(store.scenes.find((s) => s.id === scene.id)?.artMode).toBe('img2img')
  })

  it('persists the generated scene image into the storage provider', async () => {
    const savedRecords = initMediaWithStorage()
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    const w = mount(SceneEditor, { props: { sceneId: scene.id } })
    await w.get('[data-test="gen-scene-image"]').trigger('click')
    await flushPromises()
    await wait(100)
    const sceneImage = store.scenes.find((s) => s.id === scene.id)?.sceneImage
    expect(sceneImage).toBeDefined()
    expect(savedRecords.some((a) => a.id === sceneImage)).toBe(true)
  })
})

describe('script panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('imports markdown into scenes and selects the first scene', async () => {
    const store = useScriptStore()
    const w = mount(ScriptPanel)
    await openAi(w)
    await inDialog('[data-test="markdown-input"]').setValue('# 第一场：屋顶\n\n小明：你好\n动作：招手\n')
    await inDialog('[data-test="import-btn"]').trigger('click')
    expect(store.scenes).toHaveLength(1)
    expect(store.scenes[0].title).toBe('第一场：屋顶')
    expect(store.scenes[0].beats).toHaveLength(2)
    expect(w.get('[data-test="scene-title"]')).toBeTruthy()
  })

  it('AI 生成剧本 reports an error when LLM is missing', async () => {
    const w = mount(ScriptPanel)
    await openAi(w)
    await inDialog('[data-test="idea-input"]').setValue('都市少年')
    await inDialog('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(inDialog('[data-test="ai-message"]').text()).toContain('未配置')
  })

  it('AI 生成剧本 imports the generated script when LLM is available', async () => {
    initProviders(['llm'])
    const store = useScriptStore()
    const w = mount(ScriptPanel)
    await openAi(w)
    await inDialog('[data-test="idea-input"]').setValue('都市少年')
    await inDialog('[data-test="ai-generate"]').trigger('click')
    await flushPromises()
    expect(store.scenes.length).toBeGreaterThan(0)
    expect(inDialog('[data-test="ai-message"]').text()).toContain('已生成')
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

  it('shows a processing state while cutting shots', async () => {
    const registry = new PluginRegistry()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    registry.register({
      id: 'llm-slow',
      name: 'LLM Slow',
      kind: 'provider',
      providerType: 'llm',
      enabled: true,
      instance: {
        id: 'llm-slow',
        name: 'LLM Slow',
        models: [],
        chat: async function* () {},
        complete: async () => {
          await gate
          return JSON.stringify({ shots: [{ prompt: '屋顶夜景', duration: 5 }] })
        },
      },
    })
    usePluginStore().init(registry)
    const store = useScriptStore()
    const storyboard = useStoryboardStore()
    const scene = store.addScene({ title: '屋顶' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(ScriptPanel)
    await w.get('[data-test="scene-item"]').trigger('click')
    await w.get('[data-test="cut-btn"]').trigger('click')
    await flushPromises()
    const btn = w.get('[data-test="cut-btn"]')
    expect(btn.text()).toContain('切分中')
    expect(btn.attributes('disabled')).toBeDefined()
    release()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(w.get('[data-test="cut-btn"]').text()).toContain('一键切分')
    expect(storyboard.shots).toHaveLength(1)
  })

  it('拒绝重复切分，避免破坏已生成的媒体', async () => {
    const store = useScriptStore()
    const storyboard = useStoryboardStore()
    const scene = store.addScene({ title: '屋顶' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(ScriptPanel)
    await w.get('[data-test="scene-item"]').trigger('click')
    await w.get('[data-test="cut-btn"]').trigger('click')
    expect(storyboard.shots).toHaveLength(1)
    storyboard.updateShot(storyboard.shots[0].id, { mediaAssets: ['已生成资产'] })
    await w.get('[data-test="cut-btn"]').trigger('click')
    expect(storyboard.shots).toHaveLength(1)
    expect(storyboard.shots[0].mediaAssets).toContain('已生成资产')
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

  it('cutSceneToShots creates shots for every beat when no LLM is configured', async () => {
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶' })
    store.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    store.addBeat(scene.id, { type: 'action', action: '小明招手' })
    const shots = await useScriptFeatures().cutSceneToShots(scene.id)
    expect(shots).toHaveLength(2)
    expect(useStoryboardStore().shots).toHaveLength(2)
  })

  it('cutSceneToShots returns an empty list for a missing scene', async () => {
    expect(await useScriptFeatures().cutSceneToShots('missing')).toEqual([])
  })

  it('cutSceneToShots uses the LLM to choreograph shots with camera moves', async () => {
    const registry = new PluginRegistry()
    const store = useScriptStore()
    const scene = store.addScene({ title: '屋顶', location: '屋顶', timeOfDay: '夜景' })
    const beat = store.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    registry.register({
      id: 'llm-shots',
      name: 'LLM Shots',
      kind: 'provider',
      providerType: 'llm',
      enabled: true,
      instance: {
        id: 'llm-shots',
        name: 'LLM Shots',
        models: [],
        chat: async function* () {},
        complete: async () =>
          JSON.stringify({
            shots: [
              {
                prompt: '屋顶夜景，少年抬头望向天空',
                shotSize: 'wide',
                angle: 'low',
                move: 'tilt',
                duration: 6,
              },
              {
                prompt: '少年特写，眼神坚定',
                type: 'image',
                shotSize: 'close-up',
                angle: 'eye-level',
                move: 'zoom-in',
                duration: 5,
                beatRef: beat.id,
                dialogue: [{ speaker: '小明', text: '你好' }],
              },
            ],
          }),
      },
    })
    usePluginStore().init(registry)
    const shots = await useScriptFeatures().cutSceneToShots(scene.id)
    expect(shots).toHaveLength(2)
    // 未显式给出 type 的镜头默认是视频
    expect(shots[0].shotType).toBe('video')
    expect(shots[0].camera).toMatchObject({
      shotSize: 'wide',
      angle: 'low',
      move: 'tilt',
      duration: 6,
    })
    expect(shots[1].shotType).toBe('image')
    expect(shots[1].beatRef).toBe(beat.id)
    expect(shots[1].metadata.dialogue).toBe('小明：你好')
    expect(shots[0].metadata.sceneContext).toBe('屋顶，夜景')
    expect(useStoryboardStore().shots).toHaveLength(2)
  })

  it('importScript parses markdown into a script', () => {
    const script = useScriptFeatures().importScript('# 第一场：屋顶\n\n小明：你好\n动作：招手\n')
    expect(script.scenes).toHaveLength(1)
    expect(script.scenes[0].beats).toHaveLength(2)
    expect(useScriptStore().script?.scenes).toHaveLength(1)
  })

  it('buildScenePrompt includes the scene description', () => {
    const scene = {
      id: 'sc1',
      title: '屋顶',
      location: '屋顶',
      timeOfDay: '夜景',
      description: '破败的老式天台，灰蓝色调',
      beats: [],
      referenceImages: [],
      metadata: {},
    }
    expect(buildScenePrompt(scene)).toContain('破败的老式天台，灰蓝色调')
  })
})
