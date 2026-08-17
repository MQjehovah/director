import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PluginRegistry } from '../../core'
import { createMediaMockPlugin } from '../../plugins/providers'
import { usePluginStore } from '../pluginStore'

describe('plugin store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('resolves nothing before init', () => {
    const s = usePluginStore()
    expect(s.mediaProvider).toBeUndefined()
    expect(s.llmProvider).toBeUndefined()
    expect(s.storageProvider).toBeUndefined()
  })
  it('exposes enabled providers after init', () => {
    const s = usePluginStore()
    const r = new PluginRegistry()
    r.register(createMediaMockPlugin())
    s.init(r)
    expect(s.mediaProvider?.id).toBe('media-mock')
    expect(s.enabledProviders('media')).toHaveLength(1)
    expect(s.isEnabled('media-mock')).toBe(true)
  })
  it('toggle disables and re-enables a provider', () => {
    const s = usePluginStore()
    const r = new PluginRegistry()
    r.register(createMediaMockPlugin())
    s.init(r)
    s.toggle('media-mock', false)
    expect(s.isEnabled('media-mock')).toBe(false)
    expect(s.mediaProvider).toBeUndefined()
    s.toggle('media-mock', true)
    expect(s.mediaProvider?.id).toBe('media-mock')
  })
  it('setActiveProvider prefers the selected provider', () => {
    const s = usePluginStore()
    const r = new PluginRegistry()
    r.register(createMediaMockPlugin())
    r.register({
      id: 'media-other',
      name: 'Other Media',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
      instance: { id: 'media-other', name: 'Other Media' },
    })
    s.init(r)
    s.setActiveProvider('media', 'media-other')
    expect(s.mediaProvider?.id).toBe('media-other')
  })

  it('getProviderInstance resolves a provider instance by id', () => {
    const s = usePluginStore()
    const r = new PluginRegistry()
    r.register(createMediaMockPlugin())
    s.init(r)
    expect(s.getProviderInstance('media-mock')).toBeDefined()
    expect(s.getProviderInstance('missing')).toBeUndefined()
    s.toggle('media-mock', false)
    expect(s.getProviderInstance('media-mock')).toBeUndefined()
  })
})
