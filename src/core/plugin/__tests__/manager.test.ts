import { describe, it, expect, vi } from 'vitest'
import { PluginRegistry } from '../registry'
import { PluginManager } from '../manager'
import type { ProviderPlugin } from '../types'

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

describe('plugin manager', () => {
  it('toggles plugins and persists state', () => {
    const m = new PluginManager(new PluginRegistry())
    m.toggle('mock', false)
    expect(m.isEnabled('mock')).toBe(false)
  })
  it('flips enabled state of a registered plugin', () => {
    const r = new PluginRegistry()
    const m = new PluginManager(r)
    m.register(makeProvider())
    expect(m.isEnabled('mock')).toBe(true)
    m.toggle('mock', false)
    expect(m.isEnabled('mock')).toBe(false)
    m.toggle('mock')
    expect(m.isEnabled('mock')).toBe(true)
  })
  it('emits stateChanged through the registry on toggle', () => {
    const r = new PluginRegistry()
    const m = new PluginManager(r)
    m.register(makeProvider())
    const spy = vi.fn()
    r.on('plugin:stateChanged', spy)
    m.toggle('mock', false)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'mock', enabled: false }))
  })
})
