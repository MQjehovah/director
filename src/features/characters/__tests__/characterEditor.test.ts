import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import CharacterGrid from '../CharacterGrid.vue'
import CharacterPanel from '../CharacterPanel.vue'
import CharacterEditor from '../CharacterEditor.vue'
import AssetPreviewOverlay from '../../shared/AssetPreviewOverlay.vue'
import { useCharacterStore } from '../../../stores/characterStore'
import { useJobStore } from '../../../stores/jobStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useCharacterFeatures } from '../useCharacterFeatures'
import { PluginRegistry } from '../../../core'
import {
  createStubLLMPlugin,
  createStubMediaPlugin,
} from '../../shared/__tests__/stubProviders'

function initProviders(types: Array<'llm' | 'media' | 'storage'>): void {
  const registry = new PluginRegistry()
  if (types.includes('llm')) registry.register(createStubLLMPlugin())
  if (types.includes('media')) registry.register(createStubMediaPlugin({ delayMs: 10 }))
  if (types.includes('storage')) {
    registry.register({
      id: 'storage-stub',
      name: 'Storage Stub',
      kind: 'provider',
      providerType: 'storage',
      enabled: true,
      instance: createStorageStub(),
    })
  }
  usePluginStore().init(registry)
}

/** 内存版存储 Provider 桩：saveAsset/loadAsset/getAssetUrl 闭环，避免依赖真实 indexedDB */
function createStorageStub() {
  const assets = new Map<string, { id: string; url: string }>()
  let seq = 0
  return {
    id: 'storage-stub',
    name: 'Storage Stub',
    async loadProject() {
      return undefined
    },
    async saveProject() {},
    async listProjects() {
      return []
    },
    async deleteProject() {},
    async saveAsset(_file: Blob | File, meta: { kind: string }) {
      seq += 1
      const id = `stub-asset-${seq}`
      const record = { id, url: `blob:stub/${id}` }
      assets.set(id, record)
      return { id, kind: meta.kind, source: 'upload' as const, metadata: {} }
    },
    async loadAsset(id: string) {
      return assets.has(id) ? { id, kind: 'image' as const, source: 'upload' as const, metadata: {} } : undefined
    },
    async getAssetUrl(asset: { id: string }) {
      return assets.get(asset.id)?.url
    },
  }
}

describe('character grid', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders characters and adds new one', async () => {
    const store = useCharacterStore()
    store.addCharacter({ name: '小明', appearance: '黑发少年' })
    const w = mount(CharacterGrid)
    expect(w.text()).toContain('小明')
    expect(w.text()).toContain('黑发少年')
    await w.get('[data-test="char-add"]').trigger('click')
    expect(w.emitted('add')).toBeTruthy()
  })

  it('prefers bio over appearance in the card summary', () => {
    const store = useCharacterStore()
    store.addCharacter({ name: '小红', bio: '温柔的医生', appearance: '长发白衣' })
    const w = mount(CharacterGrid)
    expect(w.text()).toContain('温柔的医生')
    expect(w.text()).not.toContain('长发白衣')
  })

  it('shows empty state when no characters', () => {
    const w = mount(CharacterGrid)
    expect(w.get('[data-test="empty"]').text()).toContain('暂无角色')
  })

  it('emits select when a card is clicked', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小红' })
    const w = mount(CharacterGrid)
    await w.get('[data-test="char-card"]').trigger('click')
    expect(w.emitted('select')?.[0]?.[0]).toBe(c.id)
  })
})

describe('character panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('adds a new character via the add button and opens the editor', async () => {
    const store = useCharacterStore()
    const w = mount(CharacterPanel)
    await w.get('[data-test="char-add"]').trigger('click')
    expect(store.characters).toHaveLength(1)
    expect(store.characters[0].name).toBe('新角色')
    expect(w.get('[data-test="editor-close"]')).toBeTruthy()
  })
})

describe('character editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('updates name, bio, appearance and tags', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="bio"]').setValue('不服输的都市少年')
    await w.get('[data-test="appearance"]').setValue('金发蓝眸少年')
    await w.get('[data-test="tags"]').setValue('主角, 少年')
    expect(store.getCharacter(c.id)?.bio).toBe('不服输的都市少年')
    expect(store.getCharacter(c.id)?.appearance).toBe('金发蓝眸少年')
    expect(store.getCharacter(c.id)?.tags).toEqual(['主角', '少年'])
  })

  it('updates voice and lora config', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="voice"]').setValue('zh-female')
    await w.get('[data-test="lora-name"]').setValue('lora-anime')
    await w.get('[data-test="lora-weight"]').setValue('0.8')
    const updated = store.getCharacter(c.id)
    expect(updated?.voice).toBe('zh-female')
    expect(updated?.loraConfig).toEqual({ name: 'lora-anime', weight: 0.8 })
  })

  it('AI 生成设定 fills the appearance field when LLM is available', async () => {
    initProviders(['llm'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="editor-ai-btn"]').trigger('click')
    await w.get('[data-test="seed-idea"]').setValue('银发剑士')
    await w.get('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    expect(store.getCharacter(c.id)?.appearance).toContain('银发剑士')
  })

  it('AI 生成设定 fills bio, tags, voice and appearance from structured JSON', async () => {
    const registry = new PluginRegistry()
    registry.register({
      id: 'llm-json',
      name: 'JSON LLM',
      kind: 'provider',
      providerType: 'llm',
      enabled: true,
      instance: {
        id: 'llm-json',
        name: 'JSON LLM',
        models: [],
        async chat() {
          return (async function* () {})()
        },
        async complete() {
          return JSON.stringify({
            name: '银发剑士',
            bio: '不服输的银发剑士',
            appearance: '银发蓝瞳，一身旧军装',
            tags: ['主角', '剑士'],
            voice: 'zh-female',
          })
        },
      },
    })
    usePluginStore().init(registry)
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="editor-ai-btn"]').trigger('click')
    await w.get('[data-test="seed-idea"]').setValue('银发剑士')
    await w.get('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    const updated = store.getCharacter(c.id)
    expect(updated?.name).toBe('银发剑士')
    expect(updated?.bio).toBe('不服输的银发剑士')
    expect(updated?.appearance).toContain('银发蓝瞳')
    expect(updated?.tags).toEqual(['主角', '剑士'])
    expect(updated?.voice).toBe('zh-female')
  })

  it('删除角色 removes the character and closes the editor', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="delete-character"]').trigger('click')
    expect(store.characters).toHaveLength(0)
    expect(w.emitted('close')).toBeTruthy()
  })

  it('shows a message when the LLM provider is missing', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="editor-ai-btn"]').trigger('click')
    await w.get('[data-test="seed-idea"]').setValue('银发剑士')
    await w.get('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="ai-message"]').text()).toContain('未配置')
  })

  it('参考图 ✨ 直接用角色详情生成立绘并加入参考图', async () => {
    initProviders(['media'])
    const store = useCharacterStore()
    const c = store.addCharacter({
      name: '小明',
      appearance: '黑发少年，一身旧军装',
      bio: '不服输的都市少年',
      tags: ['主角', '少年'],
    })
    const jobs = useJobStore()
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="ref-gen-btn"]').trigger('click')
    await flushPromises()
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].type).toBe('text2image')
    // 参考图提示词包含详细描述 + 简介 + 标签
    expect(jobs.jobs[0].params.prompt).toContain('黑发少年')
    expect(jobs.jobs[0].params.prompt).toContain('角色简介：不服输的都市少年')
    expect(jobs.jobs[0].params.prompt).toContain('角色标签：主角、少年')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(store.getCharacter(c.id)?.referenceImages).toHaveLength(1)
  })

  it('未配置媒体 Provider 时点击 ✨ 给出提示', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="ref-gen-btn"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="message"]').text()).toContain('未配置')
  })

  it('AI 辅助弹窗默认关闭，点击按钮打开', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    expect(w.find('[data-test="seed-idea"]').exists()).toBe(false)
    await w.get('[data-test="editor-ai-btn"]').trigger('click')
    expect(w.find('[data-test="seed-idea"]').exists()).toBe(true)
    expect(w.get('[data-test="ai-describe"]')).toBeTruthy()
  })

  it('上传参考图：保存到存储 Provider 并显示图片', async () => {
    initProviders(['storage'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })

    const input = w.get<HTMLInputElement>('[data-test="ref-upload-input"]')
    const file = new File(['fake-image'], 'cat.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    const refs = store.getCharacter(c.id)?.referenceImages ?? []
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatch(/^stub-asset-/)
    expect(w.get('[data-test="upload-message"]').text()).toContain('已上传 1 张')
    await flushPromises()
    const imgs = w.findAll('[data-test="ref-image"]')
    expect(imgs).toHaveLength(1)
    expect(imgs[0].attributes('src')).toBe(`blob:stub/${refs[0]}`)
  })

  it('未配置存储 Provider 时上传给出提示', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })

    const input = w.get<HTMLInputElement>('[data-test="ref-upload-input"]')
    const file = new File(['fake-image'], 'cat.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(w.get('[data-test="upload-message"]').text()).toContain('未配置')
    expect(store.getCharacter(c.id)?.referenceImages).toHaveLength(0)
  })

  it('点击参考图打开放大预览浮层', async () => {
    initProviders(['storage'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    mount(AssetPreviewOverlay)
    const w = mount(CharacterEditor, { props: { characterId: c.id } })

    const input = w.get<HTMLInputElement>('[data-test="ref-upload-input"]')
    const file = new File(['fake-image'], 'cat.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    const imgs = w.findAll('[data-test="ref-image"]')
    expect(imgs).toHaveLength(1)
    await imgs[0].trigger('click')
    await flushPromises()

    const overlay = document.body.querySelector('[data-test="asset-preview-overlay"]')
    expect(overlay).not.toBeNull()
    const img = document.body.querySelector('[data-test="asset-preview-image"]')
    expect(img?.getAttribute('src')).toBe(
      `blob:stub/${store.getCharacter(c.id)?.referenceImages[0]}`,
    )
  })

  it('删除参考图：从角色移除并同步 store', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    store.updateCharacter(c.id, { referenceImages: ['ref-a', 'ref-b'] })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })

    const removeBtns = w.findAll('[data-test="ref-remove"]')
    expect(removeBtns).toHaveLength(2)
    await removeBtns[0].trigger('click')

    expect(store.getCharacter(c.id)?.referenceImages).toEqual(['ref-b'])
    expect(w.findAll('[data-test="ref-remove"]')).toHaveLength(1)
    expect(w.get('[data-test="upload-message"]').text()).toContain('已删除')
  })
})

describe('useCharacterFeatures', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generateCharacterDescription returns text when LLM is available', async () => {
    initProviders(['llm'])
    const res = await useCharacterFeatures().generateCharacterDescription('银发剑士')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data?.appearance).toContain('银发剑士')
  })

  it('generateCharacterDescription parses JSON into bio/tags/voice', async () => {
    const registry = new PluginRegistry()
    registry.register({
      id: 'llm-json',
      name: 'JSON LLM',
      kind: 'provider',
      providerType: 'llm',
      enabled: true,
      instance: {
        id: 'llm-json',
        name: 'JSON LLM',
        models: [],
        async chat() {
          return (async function* () {})()
        },
        async complete() {
          return JSON.stringify({
            name: '银发剑士',
            bio: '不服输的银发剑士',
            appearance: '银发蓝瞳',
            tags: ['主角', '剑士'],
            voice: 'zh-female',
          })
        },
      },
    })
    usePluginStore().init(registry)
    const res = await useCharacterFeatures().generateCharacterDescription('银发剑士')
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({
      name: '银发剑士',
      bio: '不服输的银发剑士',
      appearance: '银发蓝瞳',
      tags: ['主角', '剑士'],
      voice: 'zh-female',
    })
  })

  it('generateCharacterDescription reports an error when LLM is missing', async () => {
    const res = await useCharacterFeatures().generateCharacterDescription('银发剑士')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error?.length ?? 0).toBeGreaterThan(0)
  })

  it('expandReferencePrompt expands a description when LLM is available', async () => {
    initProviders(['llm'])
    const res = await useCharacterFeatures().expandReferencePrompt('黑发少年')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text.length).toBeGreaterThan(0)
  })

  it('expandReferencePrompt reports an error when LLM is missing', async () => {
    const res = await useCharacterFeatures().expandReferencePrompt('黑发少年')
    expect(res.ok).toBe(false)
  })

  it('generatePortrait returns undefined and adds no job when media is missing', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const job = await useCharacterFeatures().generatePortrait(c.id)
    expect(job).toBeUndefined()
    expect(useJobStore().jobs).toHaveLength(0)
  })

  it('generatePortrait returns undefined when the character does not exist', async () => {
    initProviders(['media'])
    const job = await useCharacterFeatures().generatePortrait('missing')
    expect(job).toBeUndefined()
    expect(useJobStore().jobs).toHaveLength(0)
  })

  it('generatePortrait returns undefined when no provider has the text2image capability', async () => {
    const registry = new PluginRegistry()
    registry.register({
      id: 'vid-only',
      name: 'Video Only',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['text2video'],
      instance: {
        id: 'vid-only',
        name: 'Video Only',
        capabilities: ['text2video'],
        async generateVideo() {
          return { id: 'v-job', type: 'text2video', status: 'done', progress: 100 }
        },
      },
    })
    usePluginStore().init(registry)
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明', appearance: '黑发少年' })
    const job = await useCharacterFeatures().generatePortrait(c.id)
    expect(job).toBeUndefined()
    expect(useJobStore().jobs).toHaveLength(0)
  })

  it('generatePortrait creates a text2image job in the job store', async () => {
    initProviders(['media'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明', appearance: '黑发少年' })
    const jobs = useJobStore()
    const job = await useCharacterFeatures().generatePortrait(c.id)
    expect(job).toBeDefined()
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].id).toBe(job?.id)
    expect(jobs.jobs[0].type).toBe('text2image')
  })
})
