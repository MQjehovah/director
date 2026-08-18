import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { buildAppPlugins, applySavedProviderConfig } from './plugins/register'
import { PluginRegistry } from './core/plugin/registry'
import { collectPipelineStepDefs } from './core/plugin/pipeline'
import { usePluginStore } from './stores/pluginStore'
import { saveProviderConfig } from './features/settings/httpBackendConfig'
import AppShell from './components/layout/AppShell.vue'
import { collectModules } from './components/layout/modules'

describe('plugin integration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('registers all built-in plugins', () => {
    const r = buildAppPlugins()
    expect(r).toBeInstanceOf(PluginRegistry)
    expect(r.resolveProvider('media').length).toBeGreaterThan(0)
    expect(r.resolveProvider('llm').length).toBeGreaterThan(0)
    expect(r.resolveProvider('storage').length).toBeGreaterThan(0)
    expect(r.resolveProvider('tts')).toHaveLength(0)
  })

  it('registers all built-in pipeline step plugins in order', () => {
    const r = buildAppPlugins()
    expect(collectPipelineStepDefs(r).map((d) => d.kind)).toEqual([
      'script',
      'cut',
      'scene-art',
      'portrait',
      'render',
      'voice',
      'assemble',
    ])
  })

  it('registers all eight built-in feature modules in order', () => {
    const r = buildAppPlugins()
    expect(collectModules(r).map((m) => m.key)).toEqual([
      'characters',
      'script',
      'storyboard',
      'film',
      'tasks',
      'pipeline',
      'settings',
      'agent',
    ])
  })

  it('exposes every provider instance through the plugin store', () => {
    setActivePinia(createPinia())
    const store = usePluginStore()
    store.init(buildAppPlugins())
    expect(store.mediaProvider?.id).toBe('media-comfyui')
    expect(store.llmProvider?.id).toBe('llm-http')
    expect(store.ttsProvider).toBeUndefined()
    expect(store.storageProvider?.id).toBe('storage-indexeddb')
  })

  it('applySavedProviderConfig disables providers whose saved config is off', () => {
    setActivePinia(createPinia())
    saveProviderConfig('media-comfyui', { enabled: false })
    const store = usePluginStore()
    store.init(buildAppPlugins())
    expect(store.isEnabled('media-comfyui')).toBe(true)
    applySavedProviderConfig(store)
    expect(store.isEnabled('media-comfyui')).toBe(false)
    // 禁用了 comfyui 后，media 能力回退到下一个启用的插件（DashScope）
    expect(store.mediaProvider?.id).toBe('media-dashscope')
    expect(store.llmProvider?.id).toBe('llm-http')
  })
})

describe('app shell wiring', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('navigates through every module and renders the real panel', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    usePluginStore(pinia).init(buildAppPlugins())
    const w = mount(AppShell, { global: { plugins: [pinia] } })

    const assertions: Array<[string, string]> = [
      ['角色', 'char-add'],
      ['剧本', 'ai-btn'],
      ['分镜', 'view-grid'],
      ['成片', 'player-panel'],
      ['任务', 'jobs-drawer'],
      ['画布', 'run-all'],
      ['设置', 'enabled-summary'],
      ['AI助手', 'agent-panel'],
    ]
    const buttons = w.findAll('nav button')
    const labels = buttons.map((b) => b.text())
    expect(labels).toEqual(['角色', '剧本', '分镜', '成片', '任务', '画布', '设置', 'AI助手'])

    for (const [label, testId] of assertions) {
      await buttons[labels.indexOf(label)].trigger('click')
      expect(w.get(`[data-test="${testId}"]`)).toBeTruthy()
    }
  })
})
