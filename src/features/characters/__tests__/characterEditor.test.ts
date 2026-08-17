import { flushPromises, mount } from '@vue/test-utils'
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

function initProviders(types: Array<'llm' | 'media'>): void {
  const registry = new PluginRegistry()
  if (types.includes('llm')) registry.register(createLLMMockPlugin())
  if (types.includes('media')) registry.register(createMediaMockPlugin({ delayMs: 10 }))
  usePluginStore().init(registry)
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
    await w.get('[data-test="seed-idea"]').setValue('银发剑士')
    await w.get('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    expect(store.getCharacter(c.id)?.appearance).toContain('银发剑士')
  })

  it('shows a message when the LLM provider is missing', async () => {
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="seed-idea"]').setValue('银发剑士')
    await w.get('[data-test="ai-describe"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="message"]').text()).toContain('未配置')
  })

  it('AI 扩写 stores an editable image prompt', async () => {
    initProviders(['llm'])
    const store = useCharacterStore()
    const c = store.addCharacter({ name: '小明', appearance: '黑发少年' })
    const w = mount(CharacterEditor, { props: { characterId: c.id } })
    await w.get('[data-test="ai-expand"]').trigger('click')
    await flushPromises()
    expect(w.get<HTMLTextAreaElement>('[data-test="image-prompt"]').element.value).toContain(
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
    await w.get('[data-test="gen-portrait"]').trigger('click')
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
    await w.get('[data-test="gen-portrait"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="message"]').text()).toContain('未配置')
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
