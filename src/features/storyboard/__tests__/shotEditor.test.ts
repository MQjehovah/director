import { flushPromises, mount, DOMWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import ShotGrid from '../ShotGrid.vue'
import ShotEditor from '../ShotEditor.vue'
import ShotTimeline from '../ShotTimeline.vue'
import StoryboardPanel from '../StoryboardPanel.vue'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { useScriptStore } from '../../../stores/scriptStore'
import { useJobStore } from '../../../stores/jobStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useShotActions, buildShotPrompt } from '../useShotActions'
import { JobSchema } from '../../../core/models'
import type { Asset } from '../../../core/models'
import type { MediaCapability } from '../../../core'
import { PluginRegistry } from '../../../core'
import { createJobController } from '../../../providers/capabilities'
import { createStubMediaPlugin } from '../../shared/__tests__/stubProviders'

function inDialog(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector)
  if (!el) throw new Error(`dialog element not found: ${selector}`)
  return new DOMWrapper(el)
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

/** 注册只具备指定能力的媒体 Provider（生成方法按能力裁剪，任务生命周期完整） */
function registerCapabilityProvider(
  registry: PluginRegistry,
  opts: { id: string; caps: MediaCapability[]; jobType: string },
): void {
  const ctrl = createJobController({ pollIntervalMs: 5 })
  const { id, caps, jobType } = opts
  let seq = 0
  const instance: Record<string, unknown> = {
    id,
    name: id,
    capabilities: caps,
    getJob: ctrl.getJob,
    onJobUpdate: ctrl.onJobUpdate,
    cancelJob: ctrl.cancelJob,
  }
  const createJob = (shotRef?: string) =>
    JobSchema.parse({
      id: `${id}-job-${(seq += 1)}`,
      type: jobType,
      status: 'running',
      progress: 5,
      pluginId: id,
      shotRef,
    })
  if (caps.includes('text2image')) {
    instance.generateImage = async (p: { shotRef?: string }) => {
      const job = createJob(p.shotRef)
      ctrl.setJob(job)
      return job
    }
  }
  if (caps.includes('text2video') || caps.includes('image2video')) {
    instance.generateVideo = async (p: { shotRef?: string }) => {
      const job = createJob(p.shotRef)
      ctrl.setJob(job)
      return job
    }
  }
  registry.register({
    id,
    name: id,
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    capabilities: caps,
    instance,
  })
}

describe('shot grid', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows shots with placeholder when no asset', () => {
    const store = useStoryboardStore()
    store.addShot({ beatRef: 'b1', shotType: 'image' })
    const w = mount(ShotGrid)
    expect(w.text()).toContain('待生成')
  })

  it('renders the generated video thumbnail for an image2video shot (video appended after the input image)', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '让画面动起来' })
    store.updateShot(shot.id, {
      mediaAssets: ['https://example.com/frame.png', 'https://example.com/clip.mp4'],
    })
    const w = mount(ShotGrid)
    await flushPromises()
    const video = w.get('[data-test="shot-thumb-video"]')
    expect(video.attributes('src')).toContain('clip.mp4')
    expect(w.find('[data-test="shot-thumb-img"]').exists()).toBe(false)
  })

  it('toggles 连续生成 on video shot cards', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' })
    const w = mount(ShotGrid)
    const toggle = w.get('[data-test="continue-toggle"]')
    await toggle.find('input').setValue(true)
    expect(store.shotById(shot.id)?.metadata.continueFromPrev).toBe(true)
    await toggle.find('input').setValue(false)
    expect(store.shotById(shot.id)?.metadata.continueFromPrev).toBeUndefined()
  })

  it('does not show 连续生成 for image shots', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image' })
    const w = mount(ShotGrid)
    expect(w.find('[data-test="continue-toggle"]').exists()).toBe(false)
  })

  it('emits select with the shot id when a card is clicked', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '第一个' })
    const w = mount(ShotGrid)
    await w.get('[data-test="shot-select"]').trigger('click')
    expect(w.emitted('select')?.[0]?.[0]).toBe(shot.id)
  })

  it('reorders shots via move buttons', async () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image' as const, prompt: '第一个' })
    store.addShot({ shotType: 'image' as const, prompt: '第二个' })
    const w = mount(ShotGrid)
    const firstCard = w.findAll('[data-test="shot-card"]')[0]
    await firstCard.get('[data-test="shot-move-down"]').trigger('click')
    expect(store.shots.map((s) => s.prompt)).toEqual(['第二个', '第一个'])
  })
})

describe('shot editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates camera fields and prompt', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '初始' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="shot-size"]').setValue('close-up')
    await w.get('[data-test="angle"]').setValue('low')
    await w.get('[data-test="move"]').setValue('zoom-in')
    await w.get('[data-test="duration"]').setValue('6')
    await w.get('[data-test="prompt"]').setValue('夕阳下的少年')
    expect(store.shotById(shot.id)?.camera).toEqual({
      shotSize: 'close-up',
      angle: 'low',
      move: 'zoom-in',
      duration: 6,
    })
    expect(store.shotById(shot.id)?.prompt).toBe('夕阳下的少年')
  })

  it('updates shot type, seed and negative prompt', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="shot-type"]').setValue('video')
    await w.get('[data-test="seed"]').setValue('42')
    await w.get('[data-test="negative-prompt"]').setValue('低质量')
    expect(store.shotById(shot.id)?.shotType).toBe('video')
    expect(store.shotById(shot.id)?.seed).toBe(42)
    expect(store.shotById(shot.id)?.negativePrompt).toBe('低质量')
  })

  it('clamps the shot duration to the 10s maximum', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="duration"]').setValue('30')
    expect(store.shotById(shot.id)?.camera?.duration).toBe(10)
  })

  it('edits the shot dialogue used for subtitles', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="dialogue"]').setValue('小明：你好')
    expect(store.shotById(shot.id)?.metadata.dialogue).toBe('小明：你好')
  })

  it('shows a continuation hint when the shot continues from a previous video', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video', metadata: { continuationFrom: 'asset-x' } })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    expect(w.find('[data-test="continuation-hint"]').exists()).toBe(true)
  })

  it('generates media and appends the asset on completion', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="gen-media"]').trigger('click')
    await flushPromises()
    expect(jobs.jobs).toHaveLength(1)
    await wait(100)
    expect(store.shotById(shot.id)?.mediaAssets).toHaveLength(1)
    expect(jobs.jobs[0].status).toBe('done')
  })

  it('shows a message when the media provider is missing', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="gen-media"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="message"]').text()).toContain('未配置')
  })

  it('removes the shot', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="remove-shot"]').trigger('click')
    expect(store.shotById(shot.id)).toBeUndefined()
    expect(w.emitted('remove')?.[0]?.[0]).toBe(shot.id)
  })
})

describe('shot timeline', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders a block per shot with duration', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image' })
    store.addShot({ shotType: 'video' })
    const w = mount(ShotTimeline)
    expect(w.findAll('[data-test="timeline-shot"]')).toHaveLength(2)
    expect(w.text()).toContain('总时长')
  })

  it('renders a video thumbnail for a video shot with a generated video asset', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '奔跑' })
    store.updateShot(shot.id, {
      mediaAssets: ['https://example.com/frame.png', 'https://example.com/clip.mp4'],
    })
    const w = mount(ShotTimeline)
    await flushPromises()
    expect(w.get('[data-test="timeline-thumb-video"]').attributes('src')).toContain('clip.mp4')
  })
})

describe('storyboard panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the shot grid and opens the editor on selection', async () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image' as const, prompt: '测试镜头' })
    const w = mount(StoryboardPanel)
    expect(w.get('[data-test="shot-card"]')).toBeTruthy()
    await w.get('[data-test="shot-select"]').trigger('click')
    expect(w.get('[data-test="editor-close"]')).toBeTruthy()
  })

  it('switches to the timeline view', async () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image' })
    const w = mount(StoryboardPanel)
    await w.get('[data-test="view-timeline"]').trigger('click')
    expect(w.get('[data-test="timeline"]')).toBeTruthy()
    expect(w.findAll('[data-test="timeline-shot"]')).toHaveLength(1)
  })

  it('shows an empty state when there are no shots', () => {
    const w = mount(StoryboardPanel)
    expect(w.get('[data-test="empty"]')).toBeTruthy()
  })

  it('adds a blank shot manually without any AI or script', async () => {
    const w = mount(StoryboardPanel)
    await w.get('[data-test="add-shot"]').trigger('click')
    await inDialog('[data-test="add-shot-confirm"]').trigger('click')
    const store = useStoryboardStore()
    expect(store.shots).toHaveLength(1)
    expect(store.shots[0].shotType).toBe('image')
    expect(store.shots[0].beatRef).toBeUndefined()
    expect(w.get('[data-test="shot-card"]')).toBeTruthy()
  })

  it('creates a shot from a script beat with the prompt prefilled', async () => {
    const scriptStore = useScriptStore()
    const scene = scriptStore.addScene({ title: '屋顶' })
    const beat = scriptStore.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    const w = mount(StoryboardPanel)
    await w.get('[data-test="add-shot"]').trigger('click')
    await inDialog('[data-test="add-beat"]').setValue(beat.id)
    await inDialog('[data-test="add-shot-confirm"]').trigger('click')
    const store = useStoryboardStore()
    expect(store.shots).toHaveLength(1)
    expect(store.shots[0].beatRef).toBe(beat.id)
    expect(store.shots[0].prompt).toContain('你好')
  })
})

describe('useShotActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generateMedia creates a job, sets renderJobRef and appends the asset on completion', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job).toBeDefined()
    expect(jobs.jobs).toHaveLength(1)
    expect(store.shotById(shot.id)?.renderJobRef).toBe(job?.id)
    expect(jobs.jobs[0].type).toBe('text2image')
    await wait(100)
    expect(jobs.jobs[0].status).toBe('done')
    expect(store.shotById(shot.id)?.mediaAssets).toHaveLength(1)
  })

  it('generateMedia returns undefined when the media provider is missing', async () => {
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job).toBeUndefined()
    expect(jobs.jobs).toHaveLength(0)
    expect(store.shotById(shot.id)?.renderJobRef).toBeUndefined()
  })

  it('generateMedia returns undefined when the shot does not exist', async () => {
    initMedia()
    const job = await useShotActions().generateMedia('missing')
    expect(job).toBeUndefined()
  })

  it('generateMedia uses image2video for a video shot with an existing image asset', async () => {
    initMedia()
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '让画面动起来' })
    store.updateShot(shot.id, { mediaAssets: ['data:image/svg+xml;utf8,FAKE'] })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('image2video')
  })

  it('generateMedia uses the scene image as image2video input when present', async () => {
    initMedia()
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '让画面动起来' })
    store.updateShot(shot.id, { metadata: { sceneImageAssetId: 'scene-asset-9' } })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('image2video')
  })

  it('references the previous video for continuation only when 连续生成 is enabled', async () => {
    initMedia()
    const store = useStoryboardStore()
    const first = store.addShot({ shotType: 'video' as const, prompt: '第一段' })
    store.updateShot(first.id, {
      mediaAssets: ['https://example.com/view?filename=prev.mp4&type=output'],
    })
    const second = store.addShot({ shotType: 'video' as const, prompt: '第二段' })
    await useShotActions().generateMedia(second.id)
    await wait(100)
    // 未勾选：不续写
    expect(store.shotById(second.id)?.metadata.continuationFrom).toBeUndefined()

    // 勾选后：续写上一段视频
    store.updateShot(second.id, { metadata: { continueFromPrev: true } })
    const job = await useShotActions().generateMedia(second.id)
    expect(job).toBeDefined()
    expect(store.shotById(second.id)?.metadata.continuationFrom).toBe(
      'https://example.com/view?filename=prev.mp4&type=output',
    )
  })

  it('cutSceneToShots carries the scene image and scene context into shot metadata', () => {
    const scriptStore = useScriptStore()
    const storyboard = useStoryboardStore()
    const scene = scriptStore.addScene({
      title: '屋顶',
      location: '屋顶',
      timeOfDay: '夜景',
      description: '破败的天台',
    })
    scriptStore.addBeat(scene.id, { type: 'action', action: '少年抬头' })
    scriptStore.updateScene(scene.id, { sceneImage: 'scene-asset-1' })
    const updated = scriptStore.scenes.find((s) => s.id === scene.id)
    expect(updated).toBeDefined()
    const shots = storyboard.cutSceneToShots(updated!)
    expect(shots).toHaveLength(1)
    expect(shots[0].metadata.sceneImageAssetId).toBe('scene-asset-1')
    expect(shots[0].metadata.sceneContext).toBe('破败的天台')
  })

  it('generateMedia uses text2video for a video shot without an image asset', async () => {
    initMedia()
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '直接生成视频' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('text2video')
  })

  it('generateMedia resolves by capability: image shot uses the text2image provider', async () => {
    const registry = new PluginRegistry()
    registerCapabilityProvider(registry, { id: 'img', caps: ['text2image'], jobType: 'text2image' })
    registerCapabilityProvider(registry, { id: 'vid', caps: ['text2video'], jobType: 'text2video' })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('text2image')
    expect(job?.pluginId).toBe('img')
  })

  it('generateMedia resolves by capability: video shot uses the text2video provider', async () => {
    const registry = new PluginRegistry()
    registerCapabilityProvider(registry, { id: 'img', caps: ['text2image'], jobType: 'text2image' })
    registerCapabilityProvider(registry, { id: 'vid', caps: ['text2video'], jobType: 'text2video' })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '让画面动起来' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('text2video')
    expect(job?.pluginId).toBe('vid')
  })

  it('generateMedia fails gracefully for a video shot when no provider has a video capability', async () => {
    const registry = new PluginRegistry()
    registerCapabilityProvider(registry, { id: 'img', caps: ['text2image'], jobType: 'text2image' })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '动起来' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job).toBeUndefined()
    expect(jobs.jobs).toHaveLength(0)
  })

  it('cancelGeneration targets the owning pluginId even after the active provider switches', async () => {
    setActivePinia(createPinia())
    const registry = new PluginRegistry()
    const ctrlA = createJobController({ pollIntervalMs: 5 })
    let seq = 0
    const instanceA = {
      id: 'media-a',
      name: 'Media A',
      capabilities: ['text2image'] as MediaCapability[],
      async generateImage(p: { shotRef?: string }) {
        const job = JobSchema.parse({
          id: `a-job-${(seq += 1)}`,
          type: 'text2image',
          status: 'running',
          progress: 5,
          pluginId: 'media-a',
          shotRef: p.shotRef,
        })
        ctrlA.setJob(job)
        return job
      },
      getJob: ctrlA.getJob,
      onJobUpdate: ctrlA.onJobUpdate,
      cancelJob: ctrlA.cancelJob,
    }
    const cancelSpy = vi.spyOn(instanceA, 'cancelJob')
    registry.register({
      id: 'media-a',
      name: 'Media A',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['text2image'],
      instance: instanceA,
    })
    registerCapabilityProvider(registry, { id: 'media-b', caps: ['text2image'], jobType: 'text2image' })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    await useShotActions().generateMedia(shot.id)
    const created = jobs.jobs[0]
    expect(created?.pluginId).toBe('media-a')
    // 切换到另一个同样具备 text2image 的 Provider；取消仍应命中创建任务的 media-a
    const pluginStore = usePluginStore()
    pluginStore.setActiveProvider('media', 'media-b')
    await useShotActions().cancelGeneration(shot.id)
    expect(jobs.getJob(created?.id ?? '')?.status).toBe('canceled')
    expect(cancelSpy).toHaveBeenCalledWith(created?.id)
  })

  it('reconciles a provider that completes synchronously into the job store', async () => {
    setActivePinia(createPinia())
    const registry = new PluginRegistry()
    registry.register({
      id: 'media-sync',
      name: 'Sync Media',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['text2image'],
      instance: {
        id: 'media-sync',
        name: 'Sync Media',
        capabilities: ['text2image'],
        async generateImage() {
          return {
            id: 'sync-job',
            type: 'text2image',
            status: 'done',
            progress: 100,
            pluginId: 'media-sync',
            result: { assetIds: ['sync-asset'] },
          }
        },
        async getJob() {
          return { id: 'sync-job', type: 'text2image', status: 'done', progress: 100, result: { assetIds: ['sync-asset'] } }
        },
        onJobUpdate() {
          return () => {}
        },
        async cancelJob() {
          return { id: 'sync-job', type: 'text2image', status: 'canceled', progress: 100 }
        },
      },
    })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '同步完成' })
    await useShotActions().generateMedia(shot.id)
    expect(jobs.getJob('sync-job')?.status).toBe('done')
    expect(store.shotById(shot.id)?.mediaAssets).toContain('sync-asset')
  })

  it('generateMedia reuses a running job instead of creating a duplicate', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const first = await useShotActions().generateMedia(shot.id)
    const second = await useShotActions().generateMedia(shot.id)
    expect(second?.id).toBe(first?.id)
    expect(jobs.jobs).toHaveLength(1)
  })

  it('persists generated assets into the storage provider so they survive refresh', async () => {
    const savedRecords = initMediaWithStorage()
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    await useShotActions().generateMedia(shot.id)
    await wait(100)
    const assetId = store.shotById(shot.id)?.mediaAssets[0]
    expect(assetId).toBeDefined()
    expect(savedRecords.some((a) => a.id === assetId)).toBe(true)
  })

  it('resolves asset urls from the storage provider even without the media provider', async () => {
    const savedRecords = initMediaWithStorage()
    const actions = useShotActions()
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    await actions.generateMedia(shot.id)
    await wait(100)
    const assetId = store.shotById(shot.id)?.mediaAssets[0]
    expect(assetId).toBeDefined()
    const url = await actions.resolveAssetUrl(assetId!)
    expect(url).toBeDefined()
    expect(savedRecords.some((a) => a.id === assetId)).toBe(true)
  })

  it('cancelGeneration cancels a running job', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    await useShotActions().generateMedia(shot.id)
    expect(jobs.jobs[0].status).toBe('running')
    await useShotActions().cancelGeneration(shot.id)
    expect(jobs.jobs[0].status).toBe('canceled')
  })

  it('regenerate clears existing assets and creates a new job', async () => {
    initMedia()
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' as const, prompt: '一只黑猫' })
    const actions = useShotActions()
    await actions.generateMedia(shot.id)
    await wait(100)
    expect(store.shotById(shot.id)?.mediaAssets).toHaveLength(1)
    const job = await actions.regenerate(shot.id)
    expect(job).toBeDefined()
    expect(store.shotById(shot.id)?.mediaAssets).toHaveLength(0)
  })
})

describe('buildShotPrompt', () => {
  it('assembles camera language into the shot prompt', () => {
    const shot = {
      id: 's1',
      shotType: 'image' as const,
      prompt: '夕阳下的少年',
      metadata: {},
      mediaAssets: [],
      camera: { shotSize: 'close-up' as const, angle: 'low' as const, move: 'zoom-in' as const, duration: 5 },
    }
    expect(buildShotPrompt(shot)).toBe('夕阳下的少年，特写，仰视，推近')
  })

  it('appends duration for video shots', () => {
    const shot = {
      id: 's1',
      shotType: 'video' as const,
      prompt: '奔跑的猫',
      metadata: {},
      mediaAssets: [],
      camera: { shotSize: 'wide' as const, angle: 'eye-level' as const, move: 'tracking' as const, duration: 8 },
    }
    expect(buildShotPrompt(shot)).toBe('奔跑的猫，全景，平视，跟拍，时长约 8 秒')
  })

  it('returns the base prompt when there is no camera', () => {
    const shot = { id: 's1', shotType: 'image' as const, prompt: '一只黑猫', metadata: {}, mediaAssets: [] }
    expect(buildShotPrompt(shot)).toBe('一只黑猫')
  })

  it('prefixes the scene context into the shot prompt', () => {
    const shot = {
      id: 's1',
      shotType: 'image' as const,
      prompt: '少年抬头',
      metadata: { sceneContext: '屋顶，夜景' },
      mediaAssets: [],
    }
    expect(buildShotPrompt(shot)).toBe('场景：屋顶，夜景，少年抬头')
  })
})
