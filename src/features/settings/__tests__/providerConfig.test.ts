import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import ProviderConfig from '../ProviderConfig.vue'
import SettingsPanel from '../SettingsPanel.vue'
import { usePluginStore } from '../../../stores/pluginStore'
import { PluginRegistry } from '../../../core'
import type { ProviderPlugin } from '../../../core/plugin/types'
import {
  clearProviderConfig,
  loadProviderConfig,
  loadProviderConfigs,
  saveProviderConfig,
} from '../httpBackendConfig'
import {
  createStorageIndexedDBPlugin,
} from '../../../plugins/providers'
import {
  createStubLLMPlugin,
  createStubMediaPlugin,
  createStubTTSPlugin,
} from '../../shared/__tests__/stubProviders'
import { saveWorkflowTemplate } from '../../../features/comfyui/workflowStore'
import { MEDIA_COMFYUI_ID } from '../../../plugins/providers/media-comfyui'

const STORAGE_PREFIX = 'ai-director:provider:'

function makeProvider(id = 'mock'): ProviderPlugin {
  return {
    id,
    name: 'Mock 媒体',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    configFields: ['baseUrl', 'apiKey', 'model'],
  }
}

function initStore(provider: ProviderPlugin): void {
  const registry = new PluginRegistry()
  registry.register(provider)
  usePluginStore().init(registry)
}

function initAllProviders(): void {
  const registry = new PluginRegistry()
  registry.register(createStubMediaPlugin())
  registry.register(createStubLLMPlugin())
  registry.register(createStubTTSPlugin())
  registry.register(createStorageIndexedDBPlugin())
  usePluginStore().init(registry)
}

describe('http backend config', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves and loads a provider config round-trip', () => {
    saveProviderConfig('media-http', {
      baseUrl: 'http://localhost:8000',
      apiKey: 'sk-test',
      model: 'flux',
    })
    expect(loadProviderConfig('media-http')).toEqual({
      baseUrl: 'http://localhost:8000',
      apiKey: 'sk-test',
      model: 'flux',
    })
  })

  it('loads all provider configs from localStorage', () => {
    saveProviderConfig('media-http', { model: 'flux' })
    saveProviderConfig('llm-http', { model: 'qwen' })
    expect(loadProviderConfigs()).toEqual({
      'media-http': { model: 'flux' },
      'llm-http': { model: 'qwen' },
    })
  })

  it('clears a provider config', () => {
    saveProviderConfig('media-http', { model: 'flux' })
    clearProviderConfig('media-http')
    expect(loadProviderConfig('media-http')).toBeUndefined()
    expect(loadProviderConfigs()).toEqual({})
  })

  it('returns undefined for a missing config', () => {
    expect(loadProviderConfig('missing')).toBeUndefined()
  })

  it('tolerates corrupt JSON in storage', () => {
    localStorage.setItem(`${STORAGE_PREFIX}bad`, '{oops')
    expect(loadProviderConfig('bad')).toBeUndefined()
    expect(loadProviderConfigs()).toEqual({})
  })

  it('tolerates non-object JSON in storage', () => {
    localStorage.setItem(`${STORAGE_PREFIX}arr`, '[1,2,3]')
    expect(loadProviderConfig('arr')).toBeUndefined()
  })

  it('tolerates unavailable localStorage on read', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const length = vi.spyOn(Storage.prototype, 'length', 'get').mockReturnValue(0)
    expect(loadProviderConfigs()).toEqual({})
    expect(loadProviderConfig('media-http')).toBeUndefined()
    getItem.mockRestore()
    length.mockRestore()
  })
})

describe('provider config', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('toggles provider and persists', async () => {
    const provider = makeProvider()
    initStore(provider)
    const store = usePluginStore()
    const w = mount(ProviderConfig, { props: { provider } })
    expect(store.isEnabled('mock')).toBe(true)
    await w.find('input[type=checkbox]').setValue(false)
    expect(store.isEnabled('mock')).toBe(false)
    await vi.runAllTimersAsync()
    expect(loadProviderConfig('mock')?.enabled).toBe(false)
  })

  it('renders the provider name and type badge', () => {
    const provider = makeProvider()
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    expect(w.text()).toContain('Mock 媒体')
    expect(w.get('[data-test="provider-type"]').text()).toBe('media')
  })

  it('persists config field inputs via saveProviderConfig', async () => {
    const provider = makeProvider()
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    await w.get('[data-test="provider-header"]').trigger('click')
    await w.get('[data-test="config-base-url"]').setValue('http://example.com')
    await w.get('[data-test="config-api-key"]').setValue('sk-test')
    await w.get('[data-test="config-model"]').setValue('flux')
    await vi.runAllTimersAsync()
    expect(loadProviderConfig('mock')).toMatchObject({
      baseUrl: 'http://example.com',
      apiKey: 'sk-test',
      model: 'flux',
    })
  })

  it('renders workflowTemplateId as a select of saved templates', async () => {
    saveWorkflowTemplate({ id: 'tpl-a', name: '我的模板', graphJson: '{}' })
    const provider: ProviderPlugin = {
      ...makeProvider(),
      configFields: ['baseUrl', 'workflowTemplateId'],
    }
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    await w.get('[data-test="provider-header"]').trigger('click')
    const select = w.get('[data-test="config-workflow-template-id"]')
    expect(select.element.tagName).toBe('SELECT')
    const optionLabels = select.findAll('option').map((o) => o.text())
    expect(optionLabels).toContain('默认内置模板')
    expect(optionLabels).toContain('我的模板')
  })

  it('renders only the declared config fields', async () => {
    const provider: ProviderPlugin = {
      ...makeProvider(),
      configFields: ['baseUrl'],
    }
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    await w.get('[data-test="provider-header"]').trigger('click')
    expect(w.find('[data-test="config-base-url"]').exists()).toBe(true)
    expect(w.find('[data-test="config-api-key"]').exists()).toBe(false)
    expect(w.find('[data-test="config-model"]').exists()).toBe(false)
  })

  it('shows capability assignment rows with a provider select per capability', async () => {
    const provider = createStubMediaPlugin()
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    await w.get('[data-test="provider-header"]').trigger('click')
    const rows = w.findAll('[data-test="cap-assign-row"]')
    expect(rows).toHaveLength(5)
    const text = w.get('[data-test="capability-assignment"]').text()
    expect(text).toContain('文生图')
    expect(text).toContain('参考生图')
    expect(text).toContain('文生视频')
    expect(text).toContain('参考生视频')
    expect(text).toContain('首尾帧生视频')
    const select = w.get('[data-test="cap-assign-text2image"]')
    expect(select.findAll('option').map((o) => o.text())).toContain('Stub 媒体')
  })

  it('marks capabilities currently provided by this provider and assigns another provider', async () => {
    const provider = createStubMediaPlugin()
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    await w.get('[data-test="provider-header"]').trigger('click')
    expect(w.findAll('[data-test="cap-providing"]')).toHaveLength(5)

    // 注册第二个同样具备文生图的 Provider，并在卡片里指派给它
    const registry = new PluginRegistry()
    registry.register(createStubMediaPlugin())
    registry.register({
      id: 'media-other',
      name: 'Other Media',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      capabilities: ['text2image'],
      instance: { id: 'media-other', name: 'Other Media' },
    })
    usePluginStore().init(registry)
    const w2 = mount(ProviderConfig, { props: { provider: createStubMediaPlugin() } })
    await w2.get('[data-test="provider-header"]').trigger('click')
    await w2.get('[data-test="cap-assign-text2image"]').setValue('media-other')
    const store = usePluginStore()
    expect(store.capabilityProviderFor('text2image')).toBe('media-other')
    expect(store.resolveProviderCapability('media', 'text2image')?.id).toBe('media-other')
  })

  it('shows the ComfyUI workflow template manager when expanded', async () => {
    const provider: ProviderPlugin = {
      id: MEDIA_COMFYUI_ID,
      name: 'ComfyUI 媒体',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      configFields: ['baseUrl'],
      capabilities: ['text2image'],
    }
    initStore(provider)
    const w = mount(ProviderConfig, { props: { provider } })
    expect(w.find('[data-test="workflow-template-manager"]').exists()).toBe(false)
    await w.get('[data-test="provider-header"]').trigger('click')
    expect(w.find('[data-test="workflow-template-manager"]').exists()).toBe(true)
  })

  it('hides config fields for providers without configFields (e.g. IndexedDB storage)', async () => {
    initStore(createStorageIndexedDBPlugin())
    const w = mount(ProviderConfig, { props: { provider: createStorageIndexedDBPlugin() } })
    await w.get('[data-test="provider-header"]').trigger('click')
    expect(w.find('[data-test="config-base-url"]').exists()).toBe(false)
    expect(w.find('[data-test="config-api-key"]').exists()).toBe(false)
    expect(w.find('[data-test="config-model"]').exists()).toBe(false)
    expect(w.get('[data-test="no-config-fields"]').text()).toContain('无需额外配置')
    expect(w.get('[data-test="provider-toggle"]')).toBeTruthy()
  })

  it('marks the first enabled provider as active and can switch via 设为当前使用', async () => {
    const registry = new PluginRegistry()
    registry.register({
      ...makeProvider('mock'),
      providerType: 'llm',
      name: 'Mock LLM',
      instance: { id: 'mock', name: 'Mock LLM' },
    })
    registry.register({
      ...makeProvider('llm-http'),
      id: 'llm-http',
      name: 'HTTP LLM',
      providerType: 'llm',
      instance: { id: 'llm-http', name: 'HTTP LLM' },
    })
    usePluginStore().init(registry)
    const store = usePluginStore()

    const httpRow = mount(ProviderConfig, {
      props: {
        provider: {
          ...makeProvider('llm-http'),
          id: 'llm-http',
          name: 'HTTP LLM',
          providerType: 'llm',
          instance: { id: 'llm-http', name: 'HTTP LLM' },
        },
      },
    })
    expect(httpRow.find('[data-test="provider-set-active"]').exists()).toBe(true)

    await httpRow.get('[data-test="provider-set-active"]').trigger('click')
    expect(store.activeProviders.llm).toBe('llm-http')
    expect(store.llmProvider?.id).toBe('llm-http')
  })

  it('does not show a 当前使用 badge for any provider', async () => {
    const media = createStubMediaPlugin()
    initStore(media)
    const wMedia = mount(ProviderConfig, { props: { provider: media } })
    expect(wMedia.find('[data-test="provider-active"]').exists()).toBe(false)
    expect(wMedia.find('[data-test="provider-set-active"]').exists()).toBe(false)

    const llm = {
      ...makeProvider('llm-http'),
      id: 'llm-http',
      name: 'HTTP LLM',
      providerType: 'llm' as const,
      instance: { id: 'llm-http', name: 'HTTP LLM' },
    }
    const registry = new PluginRegistry()
    registry.register(llm)
    usePluginStore().init(registry)
    const wLlm = mount(ProviderConfig, { props: { provider: llm } })
    expect(wLlm.find('[data-test="provider-active"]').exists()).toBe(false)
  })
})

describe('settings panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('renders a provider row for every registered provider', () => {
    initAllProviders()
    const w = mount(SettingsPanel)
    expect(w.findAll('[data-test="provider-row"]')).toHaveLength(4)
  })

  it('shows the enabled capabilities summary', () => {
    initAllProviders()
    const w = mount(SettingsPanel)
    const summary = w.get('[data-test="enabled-summary"]').text()
    expect(summary).toContain('媒体生成')
    expect(summary).toContain('大语言模型')
    expect(summary).toContain('语音合成')
    expect(summary).toContain('存储')
  })

  it('shows an empty state when no providers are registered', () => {
    const w = mount(SettingsPanel)
    expect(w.get('[data-test="providers-empty"]')).toBeTruthy()
  })
})
