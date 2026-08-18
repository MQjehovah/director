import { describe, it, expect } from 'vitest'
import { PluginRegistry } from '../registry'
import { collectPipelineStepDefs, pipelineStepDefByKind } from '../pipeline'
import type { PipelinePlugin } from '../types'
import type { PipelineStep } from '../../pipeline/types'

function makeStepPlugin(
  id: string,
  kind: string,
  order?: number,
  enabled = true,
): PipelinePlugin {
  const step: PipelineStep = {
    id: kind,
    title: kind,
    enabled: true,
    run: async () => undefined,
  }
  return {
    id,
    name: kind,
    kind: 'pipeline',
    enabled,
    step: { kind, label: kind, order, factory: () => step },
  }
}

describe('pipeline step plugins', () => {
  it('collects step defs from registered pipeline plugins sorted by order', () => {
    const r = new PluginRegistry()
    r.register(makeStepPlugin('p2', 'two', 20))
    r.register(makeStepPlugin('p1', 'one', 10))
    expect(collectPipelineStepDefs(r).map((d) => d.kind)).toEqual(['one', 'two'])
  })

  it('puts plugins without order after ordered ones', () => {
    const r = new PluginRegistry()
    r.register(makeStepPlugin('p2', 'two'))
    r.register(makeStepPlugin('p1', 'one', 10))
    expect(collectPipelineStepDefs(r).map((d) => d.kind)).toEqual(['one', 'two'])
  })

  it('excludes disabled pipeline plugins', () => {
    const r = new PluginRegistry()
    r.register(makeStepPlugin('p1', 'one', 10))
    r.register(makeStepPlugin('p2', 'two', 20, false))
    expect(collectPipelineStepDefs(r).map((d) => d.kind)).toEqual(['one'])
  })

  it('resolves a step def by kind and builds a runnable step', async () => {
    const r = new PluginRegistry()
    r.register(makeStepPlugin('p1', 'hello', 10))
    const def = pipelineStepDefByKind(r, 'hello')
    expect(def?.label).toBe('hello')
    expect(def?.factory().id).toBe('hello')
    expect(pipelineStepDefByKind(r, 'missing')).toBeUndefined()
  })
})