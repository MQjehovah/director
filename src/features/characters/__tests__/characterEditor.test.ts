import { flushPromises, mount } from '@vue/test-utils'
import { DOMWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import CharacterGrid from '../CharacterGrid.vue'
import CharacterPanel from '../CharacterPanel.vue'
import CharacterEditor from '../CharacterEditor.vue'
import { useCharacterStore } from '../../../stores/characterStore'
import { useJobStore } from '../../../stores/jobStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useCharacterFeatures } from '../useCharacterFeatures'
import { PluginRegistry } from '../../../core'
import { createLLMMockPlugin, createMediaMockPlugin } from '../../../plugins/providers'

function initProviders(types: Array<'llm' | 'media' | 'storage'>): void {
  const registry = new PluginRegistry()
  if (types.includes('llm')) registry.register(createLLMMockPlugin())
  if (types.includes('media')) registry.register(createMediaMockPlugin({ delayMs: 10 }))
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

/** Dialog 通过 Teleport 渲染到 body，需要打开弹窗后从 body 查询内部元素 */
async function openAiDialog(w: ReturnType<typeof mount>): Promise<void> {
  await w.get('[data-test="editor-ai-btn"]').trigger('click')
}

function inDialog(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector)
  if (!el) throw new Error(`dialog element not found: ${selector}`)
  return new DOMWrapper(el)
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

  it('updates name, appearance and tags', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="appearance"]').setValue('金发蓝眸少年')
    await w.get('[data-test="tags"]').setValue('主角, 少年')
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
    await openAiDialog(w)
    await inDialog('[data-test="seed-idea"]').setValue('银发剑士')
    await inDialog('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    expect(store.getCharacter(c.id)?.appearance).toContain('银发剑士')
  })

  it('shows a message when the LLM provider is missing', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await openAiDialog(w)
    await inDialog('[data-test="seed-idea"]').setValue('银发剑士')
    await inDialog('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    expect(inDialog('[data-test="message"]').text()).toContain('未配置')
  })

  it('AI 扩写 stores an editable image prompt', async () => {
    initProviders(['llm'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明', appearance: '黑发少年' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await openAiDialog(w)
    await inDialog('[data-test="ai-expand"]').trigger('click')
    await flushPromises()
    expect((inDialog('[data-test="image-prompt"]').element as HTMLTextAreaElement).value).toContain(
      'Mock 回复',
    )
    expect(store.getCharacter(c.id)?.metadata.imagePrompt).toContain('Mock 回复')
  })

  it('生成立绘 creates a job and attaches the asset on completion', async () => {
    initProviders(['media'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明', appearance: '黑发少年' })
    const jobs = useJobStore()
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await openAiDialog(w)
    await inDialog('[data-test="gen-portrait"]').trigger('click')
    await flushPromises()
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].type).toBe('text2image')
    expect(jobs.jobs[0].params.prompt).toContain('黑发少年')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(store.getCharacter(c.id)?.referenceImages).toHaveLength(1)
  })

  it('shows a message when the media provider is missing', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await openAiDialog(w)
    await inDialog('[data-test="gen-portrait"]').trigger('click')
    await flushPromises()
    expect(inDialog('[data-test="message"]').text()).toContain('未配置')
  })

  it('AI 辅助弹窗默认关闭，点击按钮打开', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    expect(document.body.querySelector('[data-test="seed-idea"]')).toBeNull()
    await openAiDialog(w)
    expect(document.body.querySelector('[data-test="seed-idea"]')).not.toBeNull()
    expect(inDialog('[data-test="ai-describe"]')).toBeTruthy()
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
})

describe('useCharacterFeatures', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('generateCharacterDescription returns text when LLM is available', async () => {
    initProviders(['llm'])
    const res = await useCharacterFeatures().generateCharacterDescription('银发剑士')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.text).toContain('银发剑士')
  })

  it('generateCharacterDescription reports an error when LLM is missing', async () => {
    const res = await useCharacterFeatures().generateCharacterDescription('银发剑士')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
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
