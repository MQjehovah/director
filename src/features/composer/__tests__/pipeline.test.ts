import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PipelineRunner } from '../PipelineRunner'
import type { PipelineStep, RunReport } from '../PipelineRunner'
import {
  scriptStep,
  cutStep,
  sceneArtStep,
  portraitStep,
  renderStep,
  voiceStep,
  assembleStep,
  presetPipeline,
} from '../presetSteps'
import {
  createStubLLMPlugin,
  createStubMediaPlugin,
  createStubTTSPlugin,
} from '../../shared/__tests__/stubProviders'
import { PluginRegistry } from '../../../core'
import {
  createAssemblePipelinePlugin,
  createCutPipelinePlugin,
  createPortraitPipelinePlugin,
  createRenderPipelinePlugin,
  createSceneArtPipelinePlugin,
  createScriptPipelinePlugin,
  createVoicePipelinePlugin,
} from '../../../plugins/pipeline'
import { usePluginStore } from '../../../stores/pluginStore'
import { useScriptStore } from '../../../stores/scriptStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { useJobStore } from '../../../stores/jobStore'
import PipelineEditor from '../PipelineEditor.vue'
import ComposerPanel from '../ComposerPanel.vue'

function initPipelinePlugins(registry: PluginRegistry): void {
  registry.register(createScriptPipelinePlugin())
  registry.register(createCutPipelinePlugin())
  registry.register(createSceneArtPipelinePlugin())
  registry.register(createPortraitPipelinePlugin())
  registry.register(createRenderPipelinePlugin())
  registry.register(createVoicePipelinePlugin())
  registry.register(createAssemblePipelinePlugin())
}

function initProviders(opts: { llm?: boolean; media?: boolean; tts?: boolean } = {}): void {
  const registry = new PluginRegistry()
  if (opts.llm) registry.register(createStubLLMPlugin())
  if (opts.media) registry.register(createStubMediaPlugin({ delayMs: 20 }))
  if (opts.tts) registry.register(createStubTTSPlugin())
  initPipelinePlugins(registry)
  usePluginStore().init(registry)
}

async function runSteps(steps: PipelineStep[], input?: unknown): Promise<RunReport> {
  return new PipelineRunner({ input }).run(steps)
}

describe('pipeline runner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('executes steps in order and skips disabled', async () => {
    const order: string[] = []
    const steps = [
      { id: 'a', enabled: true, run: async () => { order.push('a') } },
      { id: 'b', enabled: false, run: async () => { order.push('b') } },
      { id: 'c', enabled: true, run: async () => { order.push('c') } },
    ]
    const r = new PipelineRunner()
    await r.run(steps)
    expect(order).toEqual(['a', 'c'])
  })

  it('skips steps flagged with skip', async () => {
    const order: string[] = []
    const steps = [
      { id: 'a', run: async () => { order.push('a') } },
      { id: 'b', skip: true, run: async () => { order.push('b') } },
    ]
    const report = await new PipelineRunner().run(steps)
    expect(order).toEqual(['a'])
    expect(report.completed).toEqual(['a'])
  })

  it('shares results between steps through the context', async () => {
    const steps: PipelineStep[] = [
      { id: 'first', run: async () => ({ n: 1 }) },
      {
        id: 'second',
        run: async (ctx) => {
          const prev = ctx.results['first'] as { n: number } | undefined
          return { n: (prev?.n ?? 0) + 1 }
        },
      },
    ]
    const report = await new PipelineRunner().run(steps)
    expect(report.results['second']).toEqual({ n: 2 })
  })

  it('records errors and continues to subsequent steps', async () => {
    const order: string[] = []
    const steps = [
      { id: 'boom', run: async () => { throw new Error('kaboom') } },
      { id: 'ok', run: async () => { order.push('ok'); return 'fine' } },
    ]
    const report = await new PipelineRunner().run(steps)
    expect(report.errors['boom']).toBe('kaboom')
    expect(report.completed).toEqual(['ok'])
    expect(report.results['ok']).toBe('fine')
    expect(report.ok).toBe(false)
  })

  it('supports ctx.setResult and ctx.fail', async () => {
    const steps: PipelineStep[] = [
      {
        id: 'manual',
        run: async (ctx) => {
          ctx.setResult('manual', { value: 42 })
        },
      },
      {
        id: 'self-fail',
        run: async (ctx) => {
          ctx.fail('self-fail', '遇到问题')
        },
      },
    ]
    const report = await new PipelineRunner().run(steps)
    expect(report.results['manual']).toEqual({ value: 42 })
    expect(report.completed).toEqual(['manual'])
    expect(report.errors['self-fail']).toBe('遇到问题')
    expect(report.ok).toBe(false)
  })

  it('passes the pipeline input through the context', async () => {
    const steps: PipelineStep[] = [
      {
        id: 'read',
        run: async (ctx) => ({ seen: ctx.input }),
      },
    ]
    const report = await new PipelineRunner({ input: '我的梗概' }).run(steps)
    expect(report.results['read']).toEqual({ seen: '我的梗概' })
  })
})

describe('preset steps', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('scriptStep fails with a clear error when the LLM provider is missing', async () => {
    const report = await runSteps([scriptStep()], '一个关于太空猫的冒险故事')
    expect(report.errors['script']).toContain('LLM')
    expect(report.ok).toBe(false)
  })

  it('scriptStep imports a script when the LLM provider is available', async () => {
    initProviders({ llm: true })
    const store = useScriptStore()
    const report = await runSteps([scriptStep()], '一个关于太空猫的冒险故事')
    expect(report.ok).toBe(true)
    expect(report.results['script']).toMatchObject({ scriptId: expect.any(String) })
    expect(store.scenes.length).toBeGreaterThan(0)
  })

  it('cutStep creates shots for every scene beat', async () => {
    initProviders({ llm: true })
    const report = await runSteps([scriptStep(), cutStep()], '一个关于太空猫的冒险故事')
    expect(report.ok).toBe(true)
    expect(report.results['cut']).toMatchObject({ shotCount: expect.any(Number) })
    expect(useStoryboardStore().shots.length).toBeGreaterThan(0)
  })

  it('renderStep creates jobs when the media provider is available', async () => {
    initProviders({ media: true })
    const storyboard = useStoryboardStore()
    storyboard.addShot({ shotType: 'image', prompt: '一只黑猫' })
    storyboard.addShot({ shotType: 'video', prompt: '黑猫奔跑' })
    const report = await runSteps([renderStep()])
    expect(report.ok).toBe(true)
    expect(useJobStore().jobs).toHaveLength(2)
    expect(report.results['render']).toMatchObject({ renderCount: 2 })
  })

  it('renderStep fails with a clear error when the media provider is missing', async () => {
    const storyboard = useStoryboardStore()
    storyboard.addShot({ shotType: 'image', prompt: '一只黑猫' })
    const report = await runSteps([renderStep()])
    expect(report.errors['render']).toContain('媒体')
    expect(report.ok).toBe(false)
  })

  it('portraitStep is a no-op success when there are no characters', async () => {
    const report = await runSteps([portraitStep()])
    expect(report.ok).toBe(true)
    expect(report.results['portrait']).toMatchObject({ portraitCount: 0 })
  })

  it('sceneArtStep generates scene images for scenes without one', async () => {
    initProviders({ media: true })
    const scriptStore = useScriptStore()
    const scene = scriptStore.addScene({ title: '屋顶', location: '屋顶', timeOfDay: '夜景' })
    scriptStore.addBeat(scene.id, { type: 'action', action: '少年抬头' })
    const report = await runSteps([sceneArtStep()])
    expect(report.ok).toBe(true)
    expect(report.results['scene-art']).toMatchObject({ sceneCount: 1 })
    expect(useJobStore().jobs.some((j) => j.type === 'text2image')).toBe(true)
  })

  it('sceneArtStep skips scenes that already have a scene image', async () => {
    initProviders({ media: true })
    const scriptStore = useScriptStore()
    scriptStore.addScene({ title: '屋顶', sceneImage: 'scene-asset-1' })
    const report = await runSteps([sceneArtStep()])
    expect(report.ok).toBe(true)
    expect(report.results['scene-art']).toMatchObject({ sceneCount: 0 })
  })

  it('sceneArtStep fails with a clear error when the media provider is missing', async () => {
    const scriptStore = useScriptStore()
    scriptStore.addScene({ title: '屋顶' })
    const report = await runSteps([sceneArtStep()])
    expect(report.errors['scene-art']).toContain('媒体')
    expect(report.ok).toBe(false)
  })

  it('voiceStep creates jobs for dialogue shots when TTS is available', async () => {
    initProviders({ tts: true })
    const scriptStore = useScriptStore()
    const storyboard = useStoryboardStore()
    const scene = scriptStore.addScene({ title: '第一场' })
    const beat = scriptStore.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    storyboard.addShot({ shotType: 'image', beatRef: beat.id })
    const report = await runSteps([voiceStep()])
    expect(report.ok).toBe(true)
    expect(report.results['voice']).toMatchObject({ voiceCount: 1 })
    expect(useJobStore().jobs.some((j) => j.type === 'tts')).toBe(true)
  })

  it('voiceStep fails with a clear error when TTS is missing', async () => {
    const report = await runSteps([voiceStep()])
    expect(report.errors['voice']).toContain('TTS')
    expect(report.ok).toBe(false)
  })

  it('cutStep is idempotent: re-cutting preserves existing shots', async () => {
    initProviders({ llm: true })
    const storyboard = useStoryboardStore()
    const scriptStore = useScriptStore()
    const scene = scriptStore.addScene({ title: '第一场' })
    scriptStore.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    await runSteps([cutStep()])
    expect(storyboard.shots).toHaveLength(1)
    storyboard.updateShot(storyboard.shots[0].id, { mediaAssets: ['preserved-asset'] })
    const second = await runSteps([cutStep()])
    expect(storyboard.shots).toHaveLength(1)
    expect(storyboard.shots[0].mediaAssets).toContain('preserved-asset')
    expect(second.results['cut']).toMatchObject({ shotCount: 0 })
  })

  it('assembleStep reports a summary', async () => {
    const report = await runSteps([assembleStep()])
    expect(report.ok).toBe(true)
    expect(report.results['assemble']).toMatchObject({ sceneCount: 0, shotCount: 0 })
  })

  it('the full preset pipeline with mocks produces script, shots and jobs', async () => {
    initProviders({ llm: true, media: true, tts: true })
    const report = await runSteps(presetPipeline(), '一个关于太空猫的冒险故事')
    expect(report.ok).toBe(true)
    expect(useScriptStore().scenes.length).toBeGreaterThan(0)
    expect(useStoryboardStore().shots.length).toBeGreaterThan(0)
    expect(useJobStore().jobs.length).toBeGreaterThan(0)
    expect(report.completed).toEqual([
      'script',
      'cut',
      'scene-art',
      'portrait',
      'render',
      'voice',
      'assemble',
    ])
  })
})

describe('pipeline editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders a row per step with its title', () => {
    const w = mount(PipelineEditor, { props: { steps: presetPipeline() } })
    expect(w.findAll('[data-test="step-row"]')).toHaveLength(7)
    expect(w.text()).toContain('生成剧本')
    expect(w.text()).toContain('切分镜头')
    expect(w.text()).toContain('生成场景图')
    expect(w.text()).toContain('配音')
    expect(w.text()).toContain('组装成片')
  })

  it('toggles a step enabled state', async () => {
    const w = mount(PipelineEditor, { props: { steps: presetPipeline() } })
    const rows = w.findAll('[data-test="step-row"]')
    await rows[1].find('input').setValue(false)
    expect(w.emitted('toggle')?.[0]?.[0]).toEqual({ id: 'cut', enabled: false })
  })

  it('emits move when the move buttons are used', async () => {
    const w = mount(PipelineEditor, { props: { steps: presetPipeline() } })
    const rows = w.findAll('[data-test="step-row"]')
    await rows[0].get('[data-test="step-move-down"]').trigger('click')
    expect(w.emitted('move')?.[0]?.[0]).toEqual({ from: 0, to: 1 })
  })

  it('runs the pipeline and shows per-step statuses', async () => {
    const w = mount(PipelineEditor, {
      props: { steps: presetPipeline(), input: '一个关于太空猫的冒险故事' },
    })
    await w.get('[data-test="run-pipeline"]').trigger('click')
    await flushPromises()
    const statuses = w.findAll('[data-test="step-status"]').map((n) => n.text())
    expect(statuses[0]).toContain('失败')
    expect(statuses[1]).toContain('失败')
    expect(w.emitted('done')?.[0]?.[0]).toMatchObject({ ok: false })
  })
})

describe('composer panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    initProviders()
  })

  it('renders the idea input, pipeline nodes and an execute button', async () => {
    const w = mount(ComposerPanel)
    await flushPromises()
    expect(w.get('[data-test="idea-input"]')).toBeTruthy()
    expect(w.findAll('[data-test="pipeline-node"]').length).toBeGreaterThan(0)
    expect(w.get('[data-test="run-all"]')).toBeTruthy()
  })

  it('adds a node from the palette', async () => {
    const w = mount(ComposerPanel)
    await flushPromises()
    const before = w.findAll('[data-test="pipeline-node"]').length
    await w.get('[data-test="add-node-render"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-test="pipeline-node"]').length).toBe(before + 1)
  })

  it('removes a node and its connections', async () => {
    const w = mount(ComposerPanel)
    await flushPromises()
    const before = w.findAll('[data-test="pipeline-node"]').length
    await w.findAll('[data-test="node-remove"]')[0].trigger('click')
    await flushPromises()
    expect(w.findAll('[data-test="pipeline-node"]').length).toBe(before - 1)
  })

  it('runs the full pipeline with mocks producing script, shots and jobs', async () => {
    initProviders({ llm: true, media: true, tts: true })
    const w = mount(ComposerPanel)
    await w.get('[data-test="idea-input"]').setValue('一个关于太空猫的冒险故事')
    await w.get('[data-test="run-all"]').trigger('click')
    await flushPromises()
    expect(useScriptStore().scenes.length).toBeGreaterThan(0)
    expect(useStoryboardStore().shots.length).toBeGreaterThan(0)
    expect(useJobStore().jobs.length).toBeGreaterThan(0)
    expect(w.get('[data-test="report"]').text()).toContain('完成')
  })
})
