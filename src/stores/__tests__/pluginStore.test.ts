import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { PluginRegistry } from '../../core'
import type { ProviderPlugin } from '../../core'
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

  describe('capability resolution', () => {
    it('hasCapability returns true when capabilities are undefined', () => {
      const s = usePluginStore()
      expect(s.hasCapability(undefined, 'text2image')).toBe(true)
      const p: ProviderPlugin = {
        id: 'p1',
        name: 'P1',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
      }
      expect(s.hasCapability(p, 'text2image')).toBe(true)
    })

    it('hasCapability handles the legacy boolean bitmask shape', () => {
      const s = usePluginStore()
      const p: ProviderPlugin = {
        id: 'p1',
        name: 'P1',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: { text2image: true, image2video: false, text2video: false, upscale: false },
      }
      expect(s.hasCapability(p, 'text2image')).toBe(true)
      expect(s.hasCapability(p, 'image2video')).toBe(false)
      expect(s.hasCapability(p, 'upscale')).toBe(false)
    })

    it('hasCapability handles the new capability-name array shape', () => {
      const s = usePluginStore()
      const p = {
        id: 'p1',
        name: 'P1',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image', 'image2video'],
      } as unknown as ProviderPlugin
      expect(s.hasCapability(p, 'text2image')).toBe(true)
      expect(s.hasCapability(p, 'image2video')).toBe(true)
      expect(s.hasCapability(p, 'text2video')).toBe(false)
    })

    it('resolveProviderCapability returns undefined before init', () => {
      const s = usePluginStore()
      expect(s.resolveProviderCapability('media', 'text2image')).toBeUndefined()
      expect(s.resolveInstanceCapability('media', 'text2image')).toBeUndefined()
    })

    it('resolveProviderCapability prefers the active provider when it has the capability', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      r.register({
        id: 'media-other',
        name: 'Other Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: { text2image: true, image2video: false, text2video: false, upscale: false },
        instance: { id: 'media-other', name: 'Other Media' },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-other')
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('media-other')
    })

    it('resolveProviderCapability falls back when the active provider lacks the capability', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      r.register({
        id: 'media-video',
        name: 'Video Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: { text2image: false, image2video: true, text2video: false, upscale: false },
        instance: { id: 'media-video', name: 'Video Media' },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-video')
      expect(s.resolveProviderCapability('media', 'image2video')?.id).toBe('media-video')
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('media-mock')
    })

    it('resolveInstanceCapability falls back when the preferred provider has no instance', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      r.register({
        id: 'media-no-instance',
        name: 'No Instance Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image'],
      })
      s.init(r)
      s.setActiveProvider('media', 'media-no-instance')
      expect(s.resolveInstanceCapability('media', 'text2image')?.id).toBe('media-mock')
    })

    it('resolveProviderCapability skips disabled providers', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      r.register({
        id: 'media-other',
        name: 'Other Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: { text2image: true, image2video: false, text2video: false, upscale: false },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-other')
      s.toggle('media-other', false)
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('media-mock')
      s.toggle('media-mock', false)
      expect(s.resolveProviderCapability('media', 'text2image')).toBeUndefined()
    })

    it('resolveProviderCapability returns undefined when no enabled provider has the capability', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      s.init(r)
      expect(s.resolveProviderCapability('media', 'upscale')).toBeUndefined()
    })

    it('resolveProviderCapability works with the new array capabilities shape', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      r.register({
        id: 'media-array',
        name: 'Array Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image', 'image2video'],
      } as unknown as ProviderPlugin)
      s.init(r)
      s.setActiveProvider('media', 'media-array')
      expect(s.resolveProviderCapability('media', 'image2video')?.id).toBe('media-array')
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('media-array')
    })

    it('resolveInstanceCapability returns the instance of the resolved provider', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      s.init(r)
      const instance = s.resolveInstanceCapability<{ id: string }>('media', 'text2image')
      expect(instance?.id).toBe('media-mock')
      expect(s.resolveInstanceCapability('media', 'upscale')).toBeUndefined()
    })

    it('resolveInstanceCapability honors the active provider', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createMediaMockPlugin())
      r.register({
        id: 'media-other',
        name: 'Other Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: { text2image: true, image2video: false, text2video: false, upscale: false },
        instance: { id: 'media-other', name: 'Other Media' },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-other')
      expect(s.resolveInstanceCapability<{ id: string }>('media', 'text2image')?.id).toBe(
        'media-other',
      )
    })
  })
})
