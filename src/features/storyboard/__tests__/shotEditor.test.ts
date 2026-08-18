import { flushPromises, mount, DOMWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import ShotGrid from '../ShotGrid.vue'
import ShotEditor from '../ShotEditor.vue'
import ShotTimeline from '../ShotTimeline.vue'
import StoryboardPanel from '../StoryboardPanel.vue'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { useScriptStore } from '../../../stores/scriptStore'
import { useCharacterStore } from '../../../stores/characterStore'
import { useJobStore } from '../../../stores/jobStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useShotActions, buildShotPrompt } from '../useShotActions'
import { importWorkflowObject, saveWorkflowTemplate } from '../../comfyui/workflowStore'
import { saveProviderConfig } from '../../../features/settings/httpBackendConfig'
import { MEDIA_COMFYUI_ID } from '../../../plugins/providers/media-comfyui'
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
  if (
    caps.includes('text2video') ||
    caps.includes('image2video') ||
    caps.includes('firstLastFrameVideo')
  ) {
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

  it('renders only the shots passed via props when grouped by scene', () => {
    const store = useStoryboardStore()
    const a = store.addShot({ shotType: 'image', sceneId: 's1' })
    store.addShot({ shotType: 'image', sceneId: 's2' })
    const w = mount(ShotGrid, { props: { shots: [store.shotById(a.id)!] } })
    expect(w.findAll('[data-test="shot-card"]')).toHaveLength(1)
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

  it('渲染区块按模板参数显示字段并写入 shot.render', async () => {
    const objectInfo = {
      MiniMaxH3ReferenceToVideo: {
        input: {
          required: {
            prompt: ['STRING', {}],
            ref_image_size: ['COMBO', {}],
          },
          optional: {
            ref_images: [
              'COMFY_AUTOGROW_V3',
              {
                prefix: 'ref_image_',
                max: 9,
                template: { input: { required: { ref_image: ['IMAGE', {}] } } },
              },
            ],
            ref_videos: [
              'COMFY_AUTOGROW_V3',
              {
                prefix: 'ref_video_',
                max: 3,
                template: { input: { required: { ref_video: ['IMAGE', {}] } } },
              },
            ],
          },
        },
      },
    }
    const tpl = importWorkflowObject(
      '渲染模板',
      {
        ref: {
          class_type: 'MiniMaxH3ReferenceToVideo',
          inputs: {
            prompt: 'x',
            ref_image_size: 'match',
            'ref_images.ref_image_0': null,
            'ref_videos.ref_video_0': null,
          },
        },
        cl: {
          class_type: 'CLIPLoader',
          inputs: {
            clip_name: 'q.safetensors',
            type: 'minimax',
            device: 'default',
          },
        },
        v1: {
          class_type: 'VAELoader',
          inputs: { vae_name: 'v.safetensors' },
        },
        v2: {
          class_type: 'VAELoader',
          inputs: { vae_name: 'a.safetensors' },
        },
      },
      undefined,
      objectInfo,
    )
    if ('error' in tpl) throw new Error(tpl.error)
    saveWorkflowTemplate(tpl)
    saveProviderConfig(MEDIA_COMFYUI_ID, { imageVideoWorkflowTemplateId: tpl.id })
    const store = useStoryboardStore()
    const characterStore = useCharacterStore()
    const hero = characterStore.addCharacter({ name: '银发剑士' })
    characterStore.updateCharacter(hero.id, { referenceImages: ['char-img-1'] })
    const shot = store.addShot({ shotType: 'video' as const })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })

    await w.get('[data-test="render-mode"]').setValue('ref2v')
    await flushPromises()
    expect(w.find('[data-test="render-ref2v-fields"]').exists()).toBe(true)
    const imageSelect = w.get('[data-test="render-param-ref_images.ref_image_0"]')
    await imageSelect.setValue('char-img-1')
    await flushPromises()

    expect(store.shotById(shot.id)?.render?.mode).toBe('ref2v')
    expect(store.shotById(shot.id)?.render?.params).toMatchObject({
      'ref:ref_images.ref_image_0': 'char-img-1',
    })
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

  it('shows first/last frame upload controls for video shots but not image shots', async () => {
    const store = useStoryboardStore()
    const videoShot = store.addShot({ shotType: 'video' })
    const w = mount(ShotEditor, { props: { shotId: videoShot.id } })
    expect(w.find('[data-test="first-frame-upload"]').exists()).toBe(true)
    expect(w.find('[data-test="last-frame-upload"]').exists()).toBe(true)

    const imageShot = store.addShot({ shotType: 'image' })
    const w2 = mount(ShotEditor, { props: { shotId: imageShot.id } })
    expect(w2.find('[data-test="first-frame-upload"]').exists()).toBe(false)
    expect(w2.find('[data-test="last-frame-upload"]').exists()).toBe(false)
  })

  it('switches the video generation mode: text2video hides frame uploads', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="video-mode"]').setValue('text2video')
    expect(store.shotById(shot.id)?.videoMode).toBe('text2video')
    expect(w.find('[data-test="text2video-hint"]').exists()).toBe(true)
    expect(w.find('[data-test="first-frame-upload"]').exists()).toBe(false)
    expect(w.find('[data-test="reference-section"]').exists()).toBe(false)
  })

  it('picks a reference image from scene and character reference images', async () => {
    const scriptStore = useScriptStore()
    const characterStore = useCharacterStore()
    const scene = scriptStore.addScene({ title: '屋顶' })
    scriptStore.updateScene(scene.id, {
      sceneImage: 'scene-img',
      referenceImages: ['scene-ref'],
    })
    characterStore.addCharacter({ name: '小明', referenceImages: ['char-ref'] })
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video', sceneId: scene.id })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="video-mode"]').setValue('image2video')
    const labels = w.findAll('[data-test="ref-candidate"]').map((n) => n.text())
    expect(labels).toContain('场景图')
    expect(labels).toContain('场次参考图')
    expect(labels).toContain('角色「小明」')
    await w.findAll('[data-test="ref-candidate"]')[2].trigger('click')
    expect(store.shotById(shot.id)?.metadata.referenceImageAssetId).toBe('char-ref')
  })

  it('uploads a reference image for reference-video generation', async () => {
    const registry = new PluginRegistry()
    registry.register(createStubMediaPlugin({ delayMs: 30 }))
    registry.register({
      id: 'storage-ref',
      name: 'Ref Storage',
      kind: 'provider',
      providerType: 'storage',
      enabled: true,
      instance: {
        id: 'storage-ref',
        name: 'Ref Storage',
        async saveAsset(file: File, meta: { kind: string; source: string }) {
          return {
            id: `ref-${file.name}`,
            kind: meta.kind,
            source: meta.source,
            url: `data:image/png;base64,FAKE`,
          }
        },
        async loadAsset(id: string) {
          return { id, kind: 'image', source: 'upload', url: `data:image/png;base64,FAKE` }
        },
        async getAssetUrl(asset: Asset) {
          return asset.url
        },
        async revokeAssetUrl() {},
      },
    })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    await w.get('[data-test="video-mode"]').setValue('image2video')
    const input = w.get('[data-test="ref-input"]')
    const file = { name: 'ref.png', text: async () => '' } as unknown as File
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(store.shotById(shot.id)?.metadata.referenceImageAssetId).toBe('ref-ref.png')
  })

  it('uploads a first frame image and stores the asset id in metadata', async () => {
    const registry = new PluginRegistry()
    registry.register(
      createStubMediaPlugin({ delayMs: 30 }),
    )
    registry.register({
      id: 'storage-upload',
      name: 'Upload Storage',
      kind: 'provider',
      providerType: 'storage',
      enabled: true,
      instance: {
        id: 'storage-upload',
        name: 'Upload Storage',
        async saveAsset(file: File, meta: { kind: string; source: string }) {
          return {
            id: `upload-${file.name}`,
            kind: meta.kind,
            source: meta.source,
            url: `data:image/png;base64,FAKE`,
          }
        },
        async loadAsset(id: string) {
          return { id, kind: 'image', source: 'upload', url: `data:image/png;base64,FAKE` }
        },
        async getAssetUrl(asset: Asset) {
          return asset.url
        },
        async revokeAssetUrl() {},
      },
    })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' })
    const w = mount(ShotEditor, { props: { shotId: shot.id } })
    const input = w.get('[data-test="first-frame-input"]')
    const file = { name: 'first.png', text: async () => '' } as unknown as File
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(store.shotById(shot.id)?.metadata.firstFrameAssetId).toBe('upload-first.png')
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

  it('generateMedia passes first and last frame asset ids for 首尾帧 video generation', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '首尾帧' })
    store.updateShot(shot.id, {
      metadata: { firstFrameAssetId: 'first-asset', lastFrameAssetId: 'last-asset' },
    })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('firstLastFrameVideo')
    expect(jobs.jobs[0].params?.lastFrameAssetId).toBe('last-asset')
    expect(store.shotById(shot.id)?.metadata.inputImageAssetId).toBe('first-asset')
    expect(store.shotById(shot.id)?.metadata.firstFrameAssetId).toBe('first-asset')
  })

  it('generateMedia gathers reference images and character context for ref2v', async () => {
    const registry = new PluginRegistry()
    const ctrl = createJobController({ pollIntervalMs: 5 })
    let videoParams: Record<string, unknown> | undefined
    registry.register({
      id: 'media-cap',
      name: 'media-cap',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['image2video'],
      instance: {
        id: 'media-cap',
        name: 'media-cap',
        capabilities: ['image2video'],
        async generateVideo(params: Record<string, unknown>) {
          videoParams = params
          const job = JobSchema.parse({
            id: 'cap-job-1',
            type: 'image2video',
            status: 'running',
            progress: 5,
            pluginId: 'media-cap',
          })
          ctrl.setJob(job)
          return job
        },
        getJob: ctrl.getJob,
        onJobUpdate: ctrl.onJobUpdate,
        cancelJob: ctrl.cancelJob,
      },
    })
    usePluginStore().init(registry)
    const storyboardStore = useStoryboardStore()
    const scriptStore = useScriptStore()
    const characterStore = useCharacterStore()
    const scene = scriptStore.addScene({
      title: 'S1',
      beats: [
        {
          id: 'b1',
          type: 'dialogue',
          dialogue: { speaker: '银发剑士', text: '起来。' },
        },
      ],
    })
    const hero = characterStore.addCharacter({
      name: '银发剑士',
      appearance: '银发蓝瞳，一身旧军装',
      tags: ['主角', '剑士'],
    })
    characterStore.updateCharacter(hero.id, {
      referenceImages: ['char-ref-1', 'char-ref-2'],
    })
    const shot = storyboardStore.addShot({
      shotType: 'video',
      sceneId: scene.id,
      prompt: '角色从长凳上站起来',
    })
    storyboardStore.updateShot(shot.id, {
      metadata: {
        referenceImageAssetId: 'explicit-ref',
        firstFrameAssetId: 'first-frame',
        sceneImageAssetId: 'scene-img',
      },
    })

    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('image2video')
    expect(videoParams?.referenceAssetIds).toEqual([
      'explicit-ref',
      'first-frame',
      'scene-img',
      'char-ref-1',
    ])
    expect(videoParams?.referenceLabels).toEqual([
      '参考图',
      '首帧',
      '场景',
      '角色「银发剑士」',
    ])
    expect(String(videoParams?.characterContext)).toContain('银发剑士')
    expect(String(videoParams?.characterContext)).toContain('标签：主角、剑士')
  })

  it('generateMedia uses render binding for ref2v (explicit refs and scalar overrides)', async () => {
    const registry = new PluginRegistry()
    const ctrl = createJobController({ pollIntervalMs: 5 })
    let videoParams: Record<string, unknown> | undefined
    registry.register({
      id: 'media-cap',
      name: 'media-cap',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['image2video'],
      instance: {
        id: 'media-cap',
        name: 'media-cap',
        capabilities: ['image2video'],
        async generateVideo(params: Record<string, unknown>) {
          videoParams = params
          const job = JobSchema.parse({
            id: 'cap-job-2',
            type: 'image2video',
            status: 'running',
            progress: 5,
            pluginId: 'media-cap',
          })
          ctrl.setJob(job)
          return job
        },
        getJob: ctrl.getJob,
        onJobUpdate: ctrl.onJobUpdate,
        cancelJob: ctrl.cancelJob,
      },
    })
    usePluginStore().init(registry)
    const objectInfo = {
      MiniMaxH3ReferenceToVideo: {
        input: {
          required: { prompt: ['STRING', {}] },
          optional: {
            ref_images: [
              'COMFY_AUTOGROW_V3',
              {
                prefix: 'ref_image_',
                max: 9,
                template: { input: { required: { ref_image: ['IMAGE', {}] } } },
              },
            ],
            ref_videos: [
              'COMFY_AUTOGROW_V3',
              {
                prefix: 'ref_video_',
                max: 3,
                template: { input: { required: { ref_video: ['IMAGE', {}] } } },
              },
            ],
          },
        },
      },
    }
    const tpl = importWorkflowObject(
      '渲染绑定模板',
      {
        ref: {
          class_type: 'MiniMaxH3ReferenceToVideo',
          inputs: {
            prompt: 'x',
            'ref_images.ref_image_0': null,
            'ref_images.ref_image_1': null,
            'ref_videos.ref_video_0': null,
          },
        },
      },
      undefined,
      objectInfo,
    )
    if ('error' in tpl) throw new Error(tpl.error)
    saveWorkflowTemplate(tpl)
    saveProviderConfig(MEDIA_COMFYUI_ID, { imageVideoWorkflowTemplateId: tpl.id })
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '角色站起来' })
    store.updateShot(shot.id, {
      render: {
        mode: 'ref2v',
        params: {
          'ref:ref_images.ref_image_0': 'asset-1',
          'ref:ref_images.ref_image_1': '',
          'ref:ref_videos.ref_video_0': 'video-1',
          'ref:unet_name': 'model-x',
        },
      },
    })

    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('image2video')
    expect(videoParams?.referenceAssetIds).toEqual(['asset-1'])
    expect(videoParams?.referenceVideoIds).toEqual(['video-1'])
    expect(videoParams?.templateOverrides).toEqual({ 'ref:unet_name': 'model-x' })
  })

  it('routing: 首尾帧 shot prefers a provider declaring firstLastFrameVideo', async () => {
    const registry = new PluginRegistry()
    registerCapabilityProvider(registry, {
      id: 'fl-only',
      caps: ['firstLastFrameVideo'],
      jobType: 'firstLastFrameVideo',
    })
    registerCapabilityProvider(registry, {
      id: 'i2v-only',
      caps: ['image2video'],
      jobType: 'image2video',
    })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '首尾帧' })
    store.updateShot(shot.id, {
      metadata: { firstFrameAssetId: 'first', lastFrameAssetId: 'last' },
    })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.pluginId).toBe('fl-only')
  })

  it('routing: falls back to image2video provider when none declares firstLastFrameVideo', async () => {
    const registry = new PluginRegistry()
    registerCapabilityProvider(registry, {
      id: 'i2v-only',
      caps: ['image2video'],
      jobType: 'image2video',
    })
    usePluginStore().init(registry)
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '首尾帧' })
    store.updateShot(shot.id, {
      metadata: { firstFrameAssetId: 'first', lastFrameAssetId: 'last' },
    })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.pluginId).toBe('i2v-only')
    expect(job?.type).toBe('image2video')
  })

  it('generateMedia uses image2video when only a last frame is set', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({ shotType: 'video' as const, prompt: '仅尾帧' })
    store.updateShot(shot.id, { metadata: { lastFrameAssetId: 'last-only' } })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('image2video')
    expect(jobs.jobs[0].params?.lastFrameAssetId).toBe('last-only')
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

  it('explicit text2video mode ignores uploaded frames and passes no image params', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({
      shotType: 'video' as const,
      prompt: '文生视频',
      videoMode: 'text2video',
    })
    store.updateShot(shot.id, {
      metadata: { firstFrameAssetId: 'first', lastFrameAssetId: 'last' },
    })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('text2video')
    expect(jobs.jobs[0].params?.imageAssetId).toBeUndefined()
    expect(jobs.jobs[0].params?.lastFrameAssetId).toBeUndefined()
  })

  it('explicit image2video mode uses the selected reference image', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({
      shotType: 'video' as const,
      prompt: '参考生视频',
      videoMode: 'image2video',
    })
    store.updateShot(shot.id, { metadata: { referenceImageAssetId: 'ref-1' } })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('image2video')
    expect(jobs.jobs[0].params?.imageAssetId).toBe('ref-1')
    expect(store.shotById(shot.id)?.metadata.firstFrameAssetId).toBe('ref-1')
  })

  it('explicit firstLastFrameVideo mode uses both frames when present', async () => {
    initMedia()
    const store = useStoryboardStore()
    const jobs = useJobStore()
    const shot = store.addShot({
      shotType: 'video' as const,
      prompt: '首尾帧',
      videoMode: 'firstLastFrameVideo',
    })
    store.updateShot(shot.id, {
      metadata: { firstFrameAssetId: 'first', lastFrameAssetId: 'last' },
    })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.type).toBe('firstLastFrameVideo')
    expect(jobs.jobs[0].params?.imageAssetId).toBe('first')
    expect(jobs.jobs[0].params?.lastFrameAssetId).toBe('last')
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

  it('prefixes the global style before the scene context', () => {
    const shot = {
      id: 's1',
      shotType: 'image' as const,
      prompt: '少年抬头',
      metadata: { sceneContext: '屋顶，夜景' },
      mediaAssets: [],
    }
    expect(buildShotPrompt(shot, '新海诚风格')).toBe(
      '风格：新海诚风格，场景：屋顶，夜景，少年抬头',
    )
  })
})
