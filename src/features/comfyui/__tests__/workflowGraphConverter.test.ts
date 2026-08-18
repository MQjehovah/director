import { describe, it, expect } from 'vitest'
import { convertWorkflowJsonToApiGraph } from '../workflowGraphConverter'
import type { ObjectInfoNodeDef } from '../workflowGraphConverter'

const ksamplerDef: ObjectInfoNodeDef = {
  input: {
    required: {
      model: ['MODEL'],
      positive: ['CONDITIONING'],
      negative: ['CONDITIONING'],
      latent_image: ['LATENT'],
      seed: ['INT', { default: 0, control_after_generate: true }],
      steps: ['INT', { default: 20 }],
      cfg: ['FLOAT', { default: 7 }],
      sampler_name: ['COMBO', { options: ['euler'] }],
      scheduler: ['COMBO', { options: ['normal'] }],
      denoise: ['FLOAT', { default: 1 }],
    },
    optional: {},
  },
}

describe('workflowGraphConverter', () => {
  it('passes through an API-format graph unchanged', () => {
    const graph = {
      '3': { class_type: 'KSampler', inputs: { seed: 42 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a' } },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(graph))
    expect(result.ok).toBe(true)
    expect(result.graph).toEqual(graph)
    expect(result.warnings).toEqual([])
  })

  it('converts a legacy UI workflow using the builtin fallback (KSampler + control_after_generate)', () => {
    const ui = {
      nodes: [
        {
          id: 3,
          type: 'KSampler',
          mode: 0,
          inputs: [
            { name: 'model', type: 'MODEL', link: 1 },
            { name: 'positive', type: 'CONDITIONING', link: 2 },
            { name: 'negative', type: 'CONDITIONING', link: 3 },
            { name: 'latent_image', type: 'LATENT', link: 4 },
          ],
          outputs: [],
          widgets_values: [42, true, 20, 8, 'euler', 'normal', 1],
        },
        {
          id: 6,
          type: 'CLIPTextEncode',
          mode: 0,
          inputs: [{ name: 'clip', type: 'CLIP', link: 5 }],
          widgets_values: ['hello'],
          outputs: [],
        },
        { id: 4, type: 'CheckpointLoaderSimple', mode: 0, inputs: [], widgets_values: ['sd15'], outputs: [] },
      ],
      links: [
        [1, 4, 0, 3, 0, 'MODEL'],
        [2, 6, 0, 3, 1, 'CONDITIONING'],
        [3, 7, 0, 3, 2, 'CONDITIONING'],
        [4, 5, 0, 3, 3, 'LATENT'],
        [5, 4, 1, 6, 0, 'CLIP'],
      ],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    const g = result.graph!
    expect(g['3'].inputs.seed).toBe(42)
    expect(g['3'].inputs.steps).toBe(20)
    expect(g['3'].inputs.cfg).toBe(8)
    expect(g['3'].inputs.sampler_name).toBe('euler')
    expect(g['3'].inputs.positive).toEqual(['6', 0])
    expect(g['6'].inputs.text).toBe('hello')
    expect(g['4'].inputs.ckpt_name).toBe('sd15')
    // 指向不存在节点 7 的引用应被清理
    expect(g['3'].inputs.negative).toBeUndefined()
  })

  it('uses object_info to map widgets including forceInput dummy skipping', () => {
    const ui = {
      nodes: [
        {
          id: 9,
          type: 'KSampler',
          mode: 0,
          inputs: [],
          widgets_values: [7, true, 25, 6, 'euler_ancestral', 'karras', 0.9],
          outputs: [],
        },
      ],
      links: [],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui), {
      objectInfo: { KSampler: ksamplerDef },
    })
    const g = result.graph!
    expect(g['9'].inputs.seed).toBe(7)
    expect(g['9'].inputs.steps).toBe(25)
    expect(g['9'].inputs.cfg).toBe(6)
    expect(g['9'].inputs.sampler_name).toBe('euler_ancestral')
    expect(g['9'].inputs.scheduler).toBe('karras')
    expect(g['9'].inputs.denoise).toBe(0.9)
    expect(g['9'].inputs.noise_seed).toBeUndefined()
  })

  it('inlines PrimitiveNode values and follows Reroute links', () => {
    const ui = {
      nodes: [
        { id: 1, type: 'PrimitiveNode', mode: 0, inputs: [], outputs: [{ links: [3] }], widgets_values: [5] },
        { id: 2, type: 'Reroute', mode: 0, inputs: [{ name: 'input', type: '*', link: 3 }], outputs: [{ links: [4] }] },
        { id: 8, type: 'EmptyLatentImage', mode: 0, inputs: [{ name: 'width', type: 'INT', link: 4 }], widgets_values: [512, 512, 1], outputs: [] },
      ],
      links: [
        [3, 1, 0, 2, 0, '*'],
        [4, 2, 0, 8, 0, 'INT'],
      ],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    const g = result.graph!
    expect(g['8'].inputs.width).toBe(5)
    expect(g['1']).toBeUndefined()
    expect(g['2']).toBeUndefined()
    // 未被连线消费的 widgets 值按顺序映射
    expect(g['8'].inputs.height).toBe(512)
  })

  it('excludes muted and bypassed nodes and drops references to them', () => {
    const ui = {
      nodes: [
        { id: 6, type: 'CLIPTextEncode', mode: 0, inputs: [], widgets_values: ['a'], outputs: [] },
        { id: 7, type: 'CLIPTextEncode', mode: 2, inputs: [], widgets_values: ['b'], outputs: [] },
        { id: 8, type: 'VAEDecode', mode: 4, inputs: [], widgets_values: [], outputs: [] },
      ],
      links: [],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    const g = result.graph!
    expect(Object.keys(g)).toEqual(['6'])
  })

  it('wraps array widget values to avoid ambiguity with node references', () => {
    const ui = {
      nodes: [
        {
          id: 1,
          type: 'SomeComboNode',
          mode: 0,
          inputs: [],
          widgets_values: [['a', 'b'], 'x'],
          outputs: [],
        },
      ],
      links: [],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui), {
      objectInfo: {
        SomeComboNode: {
          input: {
            required: {
              multi: ['COMBO', { options: ['a', 'b'] }],
              label: ['STRING'],
            },
            optional: {},
          },
        },
      },
    })
    const g = result.graph!
    expect(g['1'].inputs.multi).toEqual({ __value__: ['a', 'b'] })
    expect(g['1'].inputs.label).toBe('x')
  })

  it('reports warnings for unmapped widget values', () => {
    const ui = {
      nodes: [
        { id: 1, type: 'UnknownNode', mode: 0, inputs: [], widgets_values: ['a', 'b'], outputs: [] },
      ],
      links: [],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('UnknownNode')
  })

  it('returns a clear error for invalid JSON', () => {
    const result = convertWorkflowJsonToApiGraph('{oops')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('解析失败')
  })
})
