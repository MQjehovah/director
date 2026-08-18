import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { PluginRegistry } from '../../core'
import type { FeaturePlugin, PipelinePlugin, ProviderPlugin } from '../../core'
import { createStubMediaPlugin } from '../../features/shared/__tests__/stubProviders'
import { usePluginStore } from '../pluginStore'

const Panel = defineComponent({ name: 'TestPanel', render: () => null })

function makePipelinePlugin(
  id: string,
  kind: string,
  order?: number,
  enabled = true,
): PipelinePlugin {
  return {
    id,
    name: kind,
    kind: 'pipeline',
    enabled,
    step: {
      kind,
      label: kind,
      order,
      factory: () => ({ id: kind, title: kind, enabled: true, run: async () => undefined }),
    },
  }
}

function makeFeaturePlugin(
  id: string,
  order?: number,
  viewProps?: Record<string, unknown>,
): FeaturePlugin {
  return {
    id,
    name: id,
    kind: 'feature',
    featureId: id,
    enabled: true,
    module: { key: id, label: id, title: id, order },
    component: Panel,
    viewProps,
  }
}

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
    r.register(createStubMediaPlugin())
    s.init(r)
    expect(s.mediaProvider?.id).toBe('stub-media')
    expect(s.enabledProviders('media')).toHaveLength(1)
    expect(s.isEnabled('stub-media')).toBe(true)
  })
  it('toggle disables and re-enables a provider', () => {
    const s = usePluginStore()
    const r = new PluginRegistry()
    r.register(createStubMediaPlugin())
    s.init(r)
    s.toggle('stub-media', false)
    expect(s.isEnabled('stub-media')).toBe(false)
    expect(s.mediaProvider).toBeUndefined()
    s.toggle('stub-media', true)
    expect(s.mediaProvider?.id).toBe('stub-media')
  })
  it('setActiveProvider prefers the selected provider', () => {
    const s = usePluginStore()
    const r = new PluginRegistry()
    r.register(createStubMediaPlugin())
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
    r.register(createStubMediaPlugin())
    s.init(r)
    expect(s.getProviderInstance('stub-media')).toBeDefined()
    expect(s.getProviderInstance('missing')).toBeUndefined()
    s.toggle('stub-media', false)
    expect(s.getProviderInstance('stub-media')).toBeUndefined()
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

    it('hasCapability still handles a legacy boolean bitmask shape defensively', () => {
      const s = usePluginStore()
      const p = {
        id: 'p1',
        name: 'P1',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: { text2image: true, image2video: false, text2video: false, upscale: false },
      } as unknown as ProviderPlugin
      expect(s.hasCapability(p, 'text2image')).toBe(true)
      expect(s.hasCapability(p, 'image2video')).toBe(false)
      expect(s.hasCapability(p, 'upscale')).toBe(false)
    })

    it('hasCapability handles the new capability-name array shape', () => {
      const s = usePluginStore()
      const p: ProviderPlugin = {
        id: 'p1',
        name: 'P1',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image', 'image2video'],
      }
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
      r.register(createStubMediaPlugin())
      r.register({
        id: 'media-other',
        name: 'Other Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image'],
        instance: { id: 'media-other', name: 'Other Media' },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-other')
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('media-other')
    })

    it('resolveProviderCapability falls back when the active provider lacks the capability', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
      r.register({
        id: 'media-video',
        name: 'Video Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['image2video'],
        instance: { id: 'media-video', name: 'Video Media' },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-video')
      expect(s.resolveProviderCapability('media', 'image2video')?.id).toBe('media-video')
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('stub-media')
    })

    it('resolveInstanceCapability falls back when the preferred provider has no instance', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
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
      expect((s.resolveInstanceCapability('media', 'text2image') as { id: string } | undefined)?.id).toBe('stub-media')
    })

    it('resolveProviderCapability skips disabled providers', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
      r.register({
        id: 'media-other',
        name: 'Other Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image'],
      })
      s.init(r)
      s.setActiveProvider('media', 'media-other')
      s.toggle('media-other', false)
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('stub-media')
      s.toggle('stub-media', false)
      expect(s.resolveProviderCapability('media', 'text2image')).toBeUndefined()
    })

    it('resolveProviderCapability returns undefined when no enabled provider has the capability', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
      s.init(r)
      expect(s.resolveProviderCapability('media', 'upscale')).toBeUndefined()
    })

    it('resolveProviderCapability works with the new array capabilities shape', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
      r.register({
        id: 'media-array',
        name: 'Array Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image', 'image2video'],
      })
      s.init(r)
      s.setActiveProvider('media', 'media-array')
      expect(s.resolveProviderCapability('media', 'image2video')?.id).toBe('media-array')
      expect(s.resolveProviderCapability('media', 'text2image')?.id).toBe('media-array')
    })

    it('resolveInstanceCapability returns the instance of the resolved provider', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
      s.init(r)
      const instance = s.resolveInstanceCapability<{ id: string }>('media', 'text2image')
      expect(instance?.id).toBe('stub-media')
      expect(s.resolveInstanceCapability('media', 'upscale')).toBeUndefined()
    })

    it('resolveInstanceCapability resolves by explicit provider id', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(createStubMediaPlugin())
      r.register({
        id: 'media-other',
        name: 'Other Media',
        kind: 'provider',
        providerType: 'media',
        enabled: true,
        capabilities: ['text2image'],
        instance: { id: 'media-other', name: 'Other Media' },
      })
      s.init(r)
      s.setActiveProvider('media', 'media-other')
      expect(
        s.resolveInstanceCapability<{ id: string }>('media', 'text2image', 'media-other')?.id,
      ).toBe('media-other')
      // 未指定 providerId 时取第一个启用的、具备该能力的 Provider
      expect(s.resolveInstanceCapability<{ id: string }>('media', 'text2image')?.id).toBe(
        'stub-media',
      )
    })
  })

  describe('pipeline step accessors', () => {
    it('collects enabled step defs sorted by order', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(makePipelinePlugin('p-b', 'b', 2))
      r.register(makePipelinePlugin('p-a', 'a', 1))
      r.register(makePipelinePlugin('p-off', 'off', 3, false))
      s.init(r)
      expect(s.pipelineStepDefs().map((d) => d.kind)).toEqual(['a', 'b'])
      expect(s.pipelineStepDef('b')?.label).toBe('b')
      expect(s.pipelineStepDef('off')).toBeUndefined()
      expect(s.pipelineStepDef('missing')).toBeUndefined()
    })

    it('returns no step defs before init', () => {
      const s = usePluginStore()
      expect(s.pipelineStepDefs()).toEqual([])
      expect(s.pipelineStepDef('a')).toBeUndefined()
    })
  })

  describe('feature module accessors', () => {
    it('returns no features before init and the registered ones after init', () => {
      const s = usePluginStore()
      expect(s.features()).toEqual([])
      expect(s.featureModules()).toEqual([])
      const r = new PluginRegistry()
      r.register(makeFeaturePlugin('a'))
      s.init(r)
      expect(s.features().map((p) => p.featureId)).toEqual(['a'])
      expect(s.featureModules().map((m) => m.key)).toEqual(['a'])
    })

    it('collects feature modules sorted by order', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(makeFeaturePlugin('b', 2))
      r.register(makeFeaturePlugin('a', 1))
      s.init(r)
      expect(s.featureModules().map((m) => m.key)).toEqual(['a', 'b'])
    })

    it('resolves the feature component by module key', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(makeFeaturePlugin('a'))
      s.init(r)
      expect(s.featureComponent('a')).toBe(Panel)
      expect(s.featureComponent('missing')).toBeUndefined()
    })

    it('resolves the feature view props by module key', () => {
      const s = usePluginStore()
      const r = new PluginRegistry()
      r.register(makeFeaturePlugin('a', 1, { open: true }))
      s.init(r)
      expect(s.featureViewProps('a')).toEqual({ open: true })
      expect(s.featureViewProps('missing')).toBeUndefined()
    })
  })
})
