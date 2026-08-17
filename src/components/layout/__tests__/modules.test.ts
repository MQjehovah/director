import { describe, it, expect } from 'vitest'
import { defineComponent } from 'vue'
import { PluginRegistry } from '../../../core/plugin/registry'
import type { FeatureModuleDef, FeaturePlugin } from '../../../core/plugin/types'
import { collectModules, resolveFeatureComponent, resolveFeatureViewProps } from '../modules'

const Panel = defineComponent({ name: 'TestPanel', render: () => null })

function makeFeature(
  id: string,
  module?: FeatureModuleDef,
  viewProps?: Record<string, unknown>,
): FeaturePlugin {
  return {
    id,
    name: id,
    kind: 'feature',
    featureId: id,
    enabled: true,
    module,
    component: Panel,
    viewProps,
  }
}

describe('module collection from the plugin registry', () => {
  it('collects modules from feature plugins sorted by order', () => {
    const r = new PluginRegistry()
    r.register(makeFeature('b', { key: 'b', label: 'B', title: 'B', order: 2 }))
    r.register(makeFeature('a', { key: 'a', label: 'A', title: 'A', order: 1 }))
    r.register(makeFeature('c', { key: 'c', label: 'C', title: 'C', order: 3 }))
    expect(collectModules(r).map((m) => m.key)).toEqual(['a', 'b', 'c'])
  })

  it('sorts modules with no order before ordered modules', () => {
    const r = new PluginRegistry()
    r.register(makeFeature('later', { key: 'later', label: 'L', title: 'L', order: 5 }))
    r.register(makeFeature('early', { key: 'early', label: 'E', title: 'E' }))
    expect(collectModules(r).map((m) => m.key)).toEqual(['early', 'later'])
  })

  it('ignores feature plugins without a module and provider plugins', () => {
    const r = new PluginRegistry()
    r.register(makeFeature('no-module'))
    r.register({
      id: 'p1',
      name: 'P1',
      kind: 'provider',
      providerType: 'media',
      enabled: true,
    })
    expect(collectModules(r)).toEqual([])
  })

  it('returns an empty list for an empty registry', () => {
    expect(collectModules(new PluginRegistry())).toEqual([])
  })

  it('resolves the component for a module key', () => {
    const r = new PluginRegistry()
    r.register(makeFeature('a', { key: 'a', label: 'A', title: 'A' }))
    expect(resolveFeatureComponent(r, 'a')).toBe(Panel)
    expect(resolveFeatureComponent(r, 'missing')).toBeUndefined()
  })

  it('resolves the view props for a module key', () => {
    const r = new PluginRegistry()
    r.register(
      makeFeature('a', { key: 'a', label: 'A', title: 'A' }, { open: true, inline: true }),
    )
    expect(resolveFeatureViewProps(r, 'a')).toEqual({ open: true, inline: true })
    expect(resolveFeatureViewProps(r, 'missing')).toBeUndefined()
  })

  it('surfaces a custom third-party feature plugin', () => {
    const r = new PluginRegistry()
    r.register(
      makeFeature('custom', { key: 'custom', label: '自定义', title: '自定义模块', order: 99 }),
    )
    const modules = collectModules(r)
    expect(modules).toHaveLength(1)
    expect(modules[0].key).toBe('custom')
    expect(modules[0].label).toBe('自定义')
    expect(resolveFeatureComponent(r, 'custom')).toBe(Panel)
  })
})
