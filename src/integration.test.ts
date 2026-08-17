import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { buildAppPlugins, applySavedProviderConfig } from './plugins/register'
import { PluginRegistry } from './core/plugin/registry'
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
    expect(r.resolveProvider('tts').length).toBeGreaterThan(0)
  })

  it('registers all seven built-in feature modules in order', () => {
    const r = buildAppPlugins()
    expect(collectModules(r).map((m) => m.key)).toEqual([
      'characters',
      'script',
      'storyboard',
      'film',
      'tasks',
      'pipeline',
      'settings',
    ])
  })

  it('exposes every provider instance through the plugin store', () => {
    setActivePinia(createPinia())
    const store = usePluginStore()
    store.init(buildAppPlugins())
    expect(store.mediaProvider?.id).toBe('media-mock')
    expect(store.llmProvider?.id).toBe('llm-mock')
    expect(store.ttsProvider?.id).toBe('tts-mock')
    expect(store.storageProvider?.id).toBe('storage-indexeddb')
  })

  it('applySavedProviderConfig disables providers whose saved config is off', () => {
    setActivePinia(createPinia())
    saveProviderConfig('media-mock', { enabled: false })
    const store = usePluginStore()
    store.init(buildAppPlugins())
    expect(store.isEnabled('media-mock')).toBe(true)
    applySavedProviderConfig(store)
    expect(store.isEnabled('media-mock')).toBe(false)
    // 禁用了 mock 后，media 能力回退到下一个启用的插件（ComfyUI）
    expect(store.mediaProvider?.id).toBe('media-comfyui')
    expect(store.llmProvider?.id).toBe('llm-mock')
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
      ['剧本', 'ai-generate'],
      ['分镜', 'view-grid'],
      ['成片', 'player-panel'],
      ['任务', 'jobs-drawer'],
      ['全流程', 'run-all'],
      ['设置', 'enabled-summary'],
    ]
    const buttons = w.findAll('nav button')
    const labels = buttons.map((b) => b.text())
    expect(labels).toEqual(['角色', '剧本', '分镜', '成片', '任务', '全流程', '设置'])

    for (const [label, testId] of assertions) {
      await buttons[labels.indexOf(label)].trigger('click')
      expect(w.get(`[data-test="${testId}"]`)).toBeTruthy()
    }
  })
})
