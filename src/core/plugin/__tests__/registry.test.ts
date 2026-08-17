import { describe, it, expect, vi } from 'vitest'
import { PluginRegistry } from '../registry'
import type { ProviderPlugin, FeaturePlugin } from '../types'

function makeProvider(): ProviderPlugin {
  return {
    id: 'mock',
    name: 'Mock',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    capabilities: ['text2image'],
  }
}

describe('plugin registry', () => {
  it('registers and resolves providers by interface', () => {
    const r = new PluginRegistry()
    r.register(makeProvider())
    expect(r.resolveProvider('media')).toHaveLength(1)
    expect(r.isEnabled('mock')).toBe(true)
  })
  it('dispatches lifecycle events', () => {
    const r = new PluginRegistry()
    const spy = vi.fn()
    r.on('plugin:registered', spy)
    r.register({ id: 'f1', name: 'F', kind: 'feature', featureId: 'characters', enabled: true } as FeaturePlugin)
    expect(spy).toHaveBeenCalled()
  })
  it('resolves providers filtered by providerType', () => {
    const r = new PluginRegistry()
    r.register(makeProvider())
    r.register({ id: 'llm1', name: 'LLM', kind: 'provider', providerType: 'llm', enabled: true, capabilities: [] })
    expect(r.resolveProvider('media')).toHaveLength(1)
    expect(r.resolveProvider('llm')).toHaveLength(1)
    expect(r.resolveProvider('tts')).toHaveLength(0)
  })
  it('resolveEnabledProvider excludes disabled providers', () => {
    const r = new PluginRegistry()
    r.register(makeProvider())
    r.register({ id: 'mock2', name: 'Mock2', kind: 'provider', providerType: 'media', enabled: false, capabilities: ['text2image'] })
    expect(r.resolveEnabledProvider('media')).toHaveLength(1)
    expect(r.resolveEnabledProvider('media')[0].id).toBe('mock')
  })
  it('returns the provider only for provider-kind plugins', () => {
    const r = new PluginRegistry()
    r.register(makeProvider())
    r.register({ id: 'f1', name: 'F', kind: 'feature', featureId: 'characters', enabled: true } as FeaturePlugin)
    expect(r.getProvider('mock')?.providerType).toBe('media')
    expect(r.getProvider('f1')).toBeUndefined()
  })
  it('rejects duplicate registration', () => {
    const r = new PluginRegistry()
    r.register(makeProvider())
    expect(() => r.register(makeProvider())).toThrow()
  })
  it('enable and disable update state and emit stateChanged', () => {
    const r = new PluginRegistry()
    r.register(makeProvider())
    const spy = vi.fn()
    r.on('plugin:stateChanged', spy)
    r.disable('mock')
    expect(r.isEnabled('mock')).toBe(false)
    r.enable('mock')
    expect(r.isEnabled('mock')).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('unsubscribing stops lifecycle events', () => {
    const r = new PluginRegistry()
    const spy = vi.fn()
    const off = r.on('plugin:registered', spy)
    r.register(makeProvider())
    off()
    r.register({ id: 'f2', name: 'F2', kind: 'feature', featureId: 'shots', enabled: true } as FeaturePlugin)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
