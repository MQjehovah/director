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

  it('imports a subgraph workflow (MarkdownNote/LoadImage/SaveImageAdvanced) without spurious warnings', () => {
    const ui = {
      nodes: [
        {
          id: 99,
          type: 'MarkdownNote',
          mode: 0,
          inputs: [],
          widgets_values: ['换脸说明文字'],
          outputs: [],
        },
        {
          id: 473,
          type: 'LoadImage',
          mode: 0,
          inputs: [
            { name: 'image', type: 'IMAGEUPLOAD', widget: { name: 'image' } },
            { name: 'upload', type: 'IMAGEUPLOAD', widget: { name: 'upload' } },
          ],
          widgets_values: ['face.png', 'image'],
          outputs: [],
        },
        {
          id: 469,
          type: 'SaveImageAdvanced',
          mode: 0,
          inputs: [
            { name: 'images', type: 'IMAGE', link: 1 },
            { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' } },
          ],
          widgets_values: ['Qwen_Image_2509', 'png', '8-bit', 'sRGB'],
          outputs: [],
        },
        {
          id: 433,
          type: 'QwenImageEdit',
          mode: 0,
          inputs: [
            { name: 'image', type: 'IMAGE', link: 2 },
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' } },
            { name: 'prompt_1', type: 'STRING', widget: { name: 'prompt_1' } },
            { name: 'seed_1', type: 'INT', widget: { name: 'seed_1' } },
            { name: 'value', type: 'BOOLEAN', widget: { name: 'value' } },
          ],
          widgets_values: ['换@图片2脸', '低分辨率，低画质', 693070387882015, true],
          outputs: [],
        },
      ],
      links: [
        [1, 433, 0, 469, 0, 'IMAGE'],
        [2, 473, 0, 433, 0, 'IMAGE'],
      ],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui), {
      objectInfo: {
        LoadImage: {
          input: { required: { image: ['IMAGEUPLOAD', { image_upload: true }] }, optional: {} },
        },
        SaveImageAdvanced: {
          input: {
            required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] },
            optional: {},
          },
        },
        QwenImageEdit: {
          input: {
            required: {
              image: ['IMAGE'],
              prompt: ['STRING'],
              prompt_1: ['STRING'],
              seed_1: ['INT'],
              value: ['BOOLEAN'],
            },
            optional: {},
          },
        },
      },
    })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 注释节点不参与执行：转换时直接排除，避免 ComfyUI 提交报 missing_node_type
    expect(g['99']).toBeUndefined()
    expect(g['473'].inputs.image).toBe('face.png')
    expect(g['473'].inputs.upload).toBe('image')
    expect(g['469'].inputs.filename_prefix).toBe('Qwen_Image_2509')
    expect(g['469'].inputs.images).toEqual(['433', 0])
    expect(g['433'].inputs.prompt).toBe('换@图片2脸')
    expect(g['433'].inputs.seed_1).toBe(693070387882015)
    expect(g['433'].inputs.image).toEqual(['473', 0])
  })

  it('preserves unmapped widget values for unknown custom nodes and warns', () => {
    const ui = {
      nodes: [
        { id: 1, type: 'SomeCustomNode', mode: 0, inputs: [], widgets_values: ['a', 42], outputs: [] },
      ],
      links: [],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain('SomeCustomNode')
    expect(result.graph!['1'].inputs.widgets_values).toEqual(['a', 42])
  })

  it('accepts widgets_values as an object (custom serializer) and maps named values', () => {
    const ui = {
      nodes: [
        {
          id: 5,
          type: 'VHS_VideoCombine',
          mode: 0,
          inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
          widgets_values: { frame_rate: 16, filename_prefix: 'out', format: 'video/h264-mp4' },
          outputs: [],
        },
        { id: 8, type: 'SomeSource', mode: 0, inputs: [], widgets_values: [], outputs: [] },
      ],
      links: [[1, 8, 0, 5, 0, 'IMAGE']],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    expect(g['5'].inputs.frame_rate).toBe(16)
    expect(g['5'].inputs.filename_prefix).toBe('out')
    expect(g['5'].inputs.format).toBe('video/h264-mp4')
    expect(g['5'].inputs.images).toEqual(['8', 0])
  })

  it('expands a subgraph instance node from definitions.subgraphs with proxy widgets and boundary links', () => {
    const ui = {
      nodes: [
        {
          id: 105,
          type: '4c314f31-ecda-4b08-ae98-faaba1bf613f',
          mode: 0,
          inputs: [
            { name: 'image', type: 'IMAGE', link: 1 },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2] }],
          properties: { proxyWidgets: [['7', 'value'], ['8', 'value']] },
          widgets_values: ['黄昏天台', 768],
        },
        {
          id: 120,
          type: 'LoadImage',
          mode: 0,
          inputs: [],
          widgets_values: ['bg.png', 'image'],
          outputs: [],
        },
        {
          id: 130,
          type: 'SaveVideo',
          mode: 0,
          inputs: [{ name: 'video', type: 'IMAGE', link: 2 }],
          widgets_values: ['out', 'auto'],
          outputs: [],
        },
      ],
      links: [
        [1, 120, 0, 105, 0, 'IMAGE'],
        [2, 105, 0, 130, 0, 'IMAGE'],
      ],
      definitions: {
        subgraphs: [
          {
            id: '4c314f31-ecda-4b08-ae98-faaba1bf613f',
            name: 'MiniMax 子图',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [{ name: 'image', linkIds: [10] }],
            outputs: [{ name: 'IMAGE', linkIds: [11] }],
            widgets: [{ name: 'prompt' }, { name: 'seed' }],
            nodes: [
              {
                id: 7,
                type: 'PrimitiveString',
                mode: 0,
                inputs: [{ name: 'value', type: 'STRING', widget: { name: 'value' } }],
                widgets_values: ['默认提示'],
                outputs: [],
              },
              {
                id: 8,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT', widget: { name: 'value' } }],
                widgets_values: [0],
                outputs: [],
              },
              {
                id: 9,
                type: 'MiniMaxH3ImageToVideo',
                mode: 0,
                inputs: [
                  { name: 'first_frame', type: 'IMAGE', link: 10 },
                  { name: 'prompt', type: 'STRING', link: 12 },
                  { name: 'seed', type: 'INT', link: 13 },
                ],
                widgets_values: [],
                outputs: [{ name: 'IMAGE', links: [11] }],
              },
            ],
            links: [
              { id: 10, origin_id: -10, origin_slot: 0, target_id: 9, target_slot: 0, type: 'IMAGE' },
              { id: 12, origin_id: 7, origin_slot: 0, target_id: 9, target_slot: 1, type: 'STRING' },
              { id: 13, origin_id: 8, origin_slot: 0, target_id: 9, target_slot: 2, type: 'INT' },
              { id: 11, origin_id: 9, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 子图实例本身不进入执行图
    expect(g['105']).toBeUndefined()
    // 提升 widget 覆盖内部 Primitive 节点
    expect(g['105:7'].class_type).toBe('PrimitiveString')
    expect(g['105:7'].inputs.value).toBe('黄昏天台')
    expect(g['105:8'].inputs.value).toBe(768)
    // 内部节点按实例ID:内部ID 展开，边界输入注入父级链接
    expect(g['105:9'].class_type).toBe('MiniMaxH3ImageToVideo')
    expect(g['105:9'].inputs.first_frame).toEqual(['120', 0])
    expect(g['105:9'].inputs.prompt).toEqual(['105:7', 0])
    expect(g['105:9'].inputs.seed).toEqual(['105:8', 0])
    // 父级对实例输出的引用重写为内部节点输出
    expect(g['130'].inputs.video).toEqual(['105:9', 0])
  })

  it('expands nested subgraphs recursively with colon-separated execution ids', () => {
    const ui = {
      nodes: [
        {
          id: 105,
          type: 'aaaa-1111',
          mode: 0,
          inputs: [],
          outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [1] }],
          widgets_values: [],
        },
        {
          id: 130,
          type: 'KSampler',
          mode: 0,
          inputs: [{ name: 'positive', type: 'CONDITIONING', link: 1 }],
          widgets_values: [42, true, 20, 8, 'euler', 'normal', 1],
          outputs: [],
        },
      ],
      links: [[1, 105, 0, 130, 0, 'CONDITIONING']],
      definitions: {
        subgraphs: [
          {
            id: 'aaaa-1111',
            name: '外层',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'CONDITIONING', linkIds: [10] }],
            widgets: [],
            nodes: [
              {
                id: 140,
                type: 'bbbb-2222',
                mode: 0,
                inputs: [],
                outputs: [{ name: 'CONDITIONING', links: [11] }],
                widgets_values: [],
              },
              {
                id: 9,
                type: 'SomeConsumer',
                mode: 0,
                inputs: [{ name: 'x', type: 'CONDITIONING', link: 11 }],
                widgets_values: [],
                outputs: [{ name: 'CONDITIONING', links: [10] }],
              },
            ],
            links: [
              { id: 11, origin_id: 140, origin_slot: 0, target_id: 9, target_slot: 0, type: 'CONDITIONING' },
              { id: 10, origin_id: 9, origin_slot: 0, target_id: -20, target_slot: 0, type: 'CONDITIONING' },
            ],
          },
          {
            id: 'bbbb-2222',
            name: '内层',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'CONDITIONING', linkIds: [40] }],
            widgets: [],
            nodes: [
              {
                id: 20,
                type: 'CLIPTextEncode',
                mode: 0,
                inputs: [],
                widgets_values: ['内层文本'],
                outputs: [{ name: 'CONDITIONING', links: [40] }],
              },
            ],
            links: [
              { id: 40, origin_id: 20, origin_slot: 0, target_id: -20, target_slot: 0, type: 'CONDITIONING' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    expect(g['105']).toBeUndefined()
    expect(g['105:140']).toBeUndefined()
    expect(g['105:140:20'].class_type).toBe('CLIPTextEncode')
    expect(g['105:140:20'].inputs.text).toBe('内层文本')
    // 嵌套输出引用逐级重写：105:140 → 105:140:20
    expect(g['105:9'].inputs.x).toEqual(['105:140:20', 0])
    expect(g['130'].inputs.positive).toEqual(['105:9', 0])
  })

  it('maps a subgraph-internal KSampler whose widgets are converted to linked inputs (kept values)', () => {
    const ui = {
      nodes: [
        {
          id: 238,
          type: 'sg-uuid',
          mode: 0,
          inputs: [],
          outputs: [{ name: 'LATENT', type: 'LATENT', links: [1] }],
          widgets_values: [],
        },
        {
          id: 250,
          type: 'SaveLatent',
          mode: 0,
          inputs: [{ name: 'latent', type: 'LATENT', link: 1 }],
          widgets_values: [],
          outputs: [],
        },
      ],
      links: [[1, 238, 0, 250, 0, 'LATENT']],
      definitions: {
        subgraphs: [
          {
            id: 'sg-uuid',
            name: '采样子图',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'LATENT', linkIds: [10] }],
            widgets: [],
            nodes: [
              {
                id: 230,
                type: 'KSampler',
                mode: 0,
                inputs: [
                  { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 15 },
                  { name: 'steps', type: 'INT', widget: { name: 'steps' }, link: 16 },
                  { name: 'cfg', type: 'FLOAT', widget: { name: 'cfg' }, link: 17 },
                  { name: 'sampler_name', type: 'COMBO', widget: { name: 'sampler_name' } },
                  { name: 'scheduler', type: 'COMBO', widget: { name: 'scheduler' } },
                  { name: 'denoise', type: 'FLOAT', widget: { name: 'denoise' } },
                ],
                widgets_values: [42, true, 20, 8, 'euler', 'normal', 1],
                outputs: [{ name: 'LATENT', links: [10] }],
              },
              {
                id: 231,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT', widget: { name: 'value' } }],
                widgets_values: [42],
                outputs: [],
              },
              {
                id: 232,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT', widget: { name: 'value' } }],
                widgets_values: [20],
                outputs: [],
              },
              {
                id: 233,
                type: 'PrimitiveFloat',
                mode: 0,
                inputs: [{ name: 'value', type: 'FLOAT', widget: { name: 'value' } }],
                widgets_values: [8],
                outputs: [],
              },
            ],
            links: [
              { id: 15, origin_id: 231, origin_slot: 0, target_id: 230, target_slot: 0, type: 'INT' },
              { id: 16, origin_id: 232, origin_slot: 0, target_id: 230, target_slot: 1, type: 'INT' },
              { id: 17, origin_id: 233, origin_slot: 0, target_id: 230, target_slot: 2, type: 'FLOAT' },
              { id: 10, origin_id: 230, origin_slot: 0, target_id: -20, target_slot: 0, type: 'LATENT' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 已连线 widget 的值与 control_after_generate 占位按位置跳过，未连线参数正确映射
    expect(g['238:230'].inputs.seed).toEqual(['238:231', 0])
    expect(g['238:230'].inputs.steps).toEqual(['238:232', 0])
    expect(g['238:230'].inputs.cfg).toEqual(['238:233', 0])
    expect(g['238:230'].inputs.sampler_name).toBe('euler')
    expect(g['238:230'].inputs.scheduler).toBe('normal')
    expect(g['238:230'].inputs.denoise).toBe(1)
  })

  it('hoists instance widget values into legacy-serialized inner nodes by input name', () => {
    const ui = {
      nodes: [
        {
          id: 227,
          type: '4c314f31-ecda-4b08-ae98-faaba1bf613f',
          mode: 0,
          inputs: [
            { name: 'ref_images', type: 'IMAGE', link: 2 },
            { name: 'width', type: 'INT', link: 3 },
            { name: 'height', type: 'INT', link: 4 },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          widgets_values: ['高角度俯视的黄昏天台…', 8],
        },
        {
          id: 115,
          type: 'ResolutionSelector',
          mode: 0,
          inputs: [],
          outputs: [
            { name: 'width', links: [3] },
            { name: 'height', links: [4] },
          ],
          widgets_values: ['16:9 (Widescreen)', 0.4, 32],
        },
        {
          id: 228,
          type: 'LoadImage',
          mode: 0,
          inputs: [
            { name: 'image', type: 'IMAGEUPLOAD', widget: { name: 'image' } },
            { name: 'upload', type: 'IMAGEUPLOAD', widget: { name: 'upload' } },
          ],
          widgets_values: ['Qwen-Image-2512_00013_.png [output]', 'image'],
          outputs: [{ name: 'IMAGE', links: [2] }],
        },
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [
            { name: 'video', type: 'IMAGE', link: 1 },
            { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' } },
            { name: 'format', type: 'COMBO', widget: { name: 'format' } },
          ],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
      ],
      links: [
        [1, 227, 0, 92, 0, 'IMAGE'],
        [2, 228, 0, 227, 0, 'IMAGE'],
        [3, 115, 0, 227, 1, 'INT'],
        [4, 115, 1, 227, 2, 'INT'],
      ],
      definitions: {
        subgraphs: [
          {
            id: '4c314f31-ecda-4b08-ae98-faaba1bf613f',
            name: 'MiniMax 参考生视频',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [
              { name: 'ref_images', linkIds: [21] },
              { name: 'width', linkIds: [22] },
              { name: 'height', linkIds: [23] },
              { name: 'clip_name', linkIds: [30] },
            ],
            outputs: [{ name: 'IMAGE', linkIds: [10] }],
            // 旧式序列化：widgets 数组提供暴露顺序，内部节点 inputs 只有 name、无 widget.name
            widgets: [{ name: 'prompt' }, { name: 'value' }],
            nodes: [
              {
                id: 215,
                type: 'MiniMaxH3ReferenceToVideo',
                mode: 0,
                inputs: [
                  { name: 'ref_images.ref_image_0', type: 'IMAGE', link: 21 },
                  { name: 'width', type: 'INT', link: 22 },
                  { name: 'height', type: 'INT', link: 23 },
                  { name: 'length', type: 'INT', link: 25 },
                  { name: 'prompt', type: 'STRING' },
                ],
                widgets_values: [],
                outputs: [{ name: 'IMAGE', links: [10] }],
              },
              {
                id: 132,
                type: 'PrimitiveFloat',
                mode: 0,
                inputs: [{ name: 'value', type: 'FLOAT' }],
                widgets_values: [],
                outputs: [],
              },
              {
                id: 131,
                type: 'ComfyMathExpression',
                mode: 0,
                inputs: [
                  { name: 'values.a', type: 'FLOAT', link: 26 },
                  { name: 'expression', type: 'STRING' },
                ],
                widgets_values: [
                  'max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17',
                ],
                outputs: [{ name: 'length', links: [25] }],
              },
              {
                id: 216,
                type: 'RandomNoise',
                mode: 0,
                inputs: [{ name: 'noise_seed', type: 'INT' }],
                widgets_values: [642251290792234],
                outputs: [],
              },
              {
                id: 224,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT' }],
                widgets_values: [20],
                outputs: [],
              },
              {
                id: 225,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT' }],
                widgets_values: [4],
                outputs: [],
              },
            ],
            links: [
              { id: 21, origin_id: -10, origin_slot: 0, target_id: 215, target_slot: 0, type: 'IMAGE' },
              { id: 22, origin_id: -10, origin_slot: 1, target_id: 215, target_slot: 1, type: 'INT' },
              { id: 23, origin_id: -10, origin_slot: 2, target_id: 215, target_slot: 2, type: 'INT' },
              { id: 25, origin_id: 131, origin_slot: 1, target_id: 215, target_slot: 3, type: 'INT' },
              { id: 26, origin_id: 132, origin_slot: 0, target_id: 131, target_slot: 0, type: 'FLOAT' },
              { id: 10, origin_id: 215, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 子图实例本身不进入执行图
    expect(g['227']).toBeUndefined()
    // 无 proxyWidgets 时按输入名提升：prompt 写入 MiniMaxH3ReferenceToVideo，数值写入 PrimitiveFloat
    expect(g['227:215'].inputs.prompt).toBe('高角度俯视的黄昏天台…')
    expect(g['227:215'].inputs['ref_images.ref_image_0']).toEqual(['228', 0])
    expect(g['227:215'].inputs.width).toEqual(['115', 0])
    expect(g['227:215'].inputs.height).toEqual(['115', 1])
    // length 由表达式链路提供，不能被实例值覆盖
    expect(g['227:215'].inputs.length).toEqual(['227:131', 1])
    expect(g['227:132'].inputs.value).toBe(8)
    expect(g['227:131'].inputs['values.a']).toEqual(['227:132', 0])
    expect(g['227:131'].inputs.expression).toContain('max(5')
    expect(g['227:216'].inputs.noise_seed).toBe(642251290792234)
    expect(g['227:224'].inputs.value).toBe(20)
    expect(g['227:225'].inputs.value).toBe(4)
    // 父级对实例输出的引用重写为内部节点输出
    expect(g['92'].inputs.video).toEqual(['227:215', 0])
  })

  it('falls back to instance input names when the subgraph def lacks widgets and proxyWidgets', () => {
    const ui = {
      nodes: [
        {
          id: 7,
          type: 'sg-legacy',
          mode: 0,
          inputs: [
            { name: 'prompt', type: 'STRING' },
            { name: 'value', type: 'FLOAT' },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          widgets_values: ['提示文本', 3.5],
        },
        {
          id: 8,
          type: 'SaveImage',
          mode: 0,
          inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
          widgets_values: ['out'],
          outputs: [],
        },
      ],
      links: [[1, 7, 0, 8, 0, 'IMAGE']],
      definitions: {
        subgraphs: [
          {
            id: 'sg-legacy',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'IMAGE', linkIds: [10] }],
            nodes: [
              {
                id: 1,
                type: 'MiniMaxH3ImageToVideo',
                mode: 0,
                inputs: [{ name: 'prompt', type: 'STRING' }],
                widgets_values: [],
                outputs: [{ name: 'IMAGE', links: [10] }],
              },
              {
                id: 2,
                type: 'PrimitiveFloat',
                mode: 0,
                inputs: [{ name: 'value', type: 'FLOAT' }],
                widgets_values: [],
                outputs: [],
              },
            ],
            links: [
              { id: 10, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    expect(g['7:1'].inputs.prompt).toBe('提示文本')
    expect(g['7:2'].inputs.value).toBe(3.5)
    expect(g['8'].inputs.images).toEqual(['7:1', 0])
  })

  it('maps the switch widget of a legacy ComfySwitchNode inside a subgraph', () => {
    const ui = {
      nodes: [
        {
          id: 227,
          type: 'sg-switch',
          mode: 0,
          inputs: [],
          outputs: [{ name: 'output', type: '*', links: [1] }],
          widgets_values: [],
        },
        {
          id: 230,
          type: 'BasicScheduler',
          mode: 0,
          inputs: [{ name: 'steps', type: 'INT', link: 1 }],
          widgets_values: ['simple', 0],
          outputs: [],
        },
      ],
      links: [[1, 227, 0, 230, 0, 'INT']],
      definitions: {
        subgraphs: [
          {
            id: 'sg-switch',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'output', linkIds: [10] }],
            nodes: [
              {
                id: 226,
                type: 'ComfySwitchNode',
                mode: 0,
                inputs: [
                  { name: 'on_false', type: '*', link: 11 },
                  { name: 'on_true', type: '*', link: 12 },
                ],
                widgets_values: [true],
                outputs: [{ name: 'output', links: [10] }],
              },
              {
                id: 224,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT' }],
                widgets_values: [20],
                outputs: [],
              },
              {
                id: 225,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT' }],
                widgets_values: [4],
                outputs: [],
              },
            ],
            links: [
              { id: 10, origin_id: 226, origin_slot: 0, target_id: -20, target_slot: 0, type: '*' },
              { id: 11, origin_id: 224, origin_slot: 0, target_id: 226, target_slot: 1, type: 'INT' },
              { id: 12, origin_id: 225, origin_slot: 0, target_id: 226, target_slot: 2, type: 'INT' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // switch 是 ComfySwitchNode 的必填 widget，必须从 widgets_values 映射为命名输入
    expect(g['227:226'].class_type).toBe('ComfySwitchNode')
    expect(g['227:226'].inputs.switch).toBe(true)
    expect(g['227:226'].inputs.on_false).toEqual(['227:224', 0])
    expect(g['227:226'].inputs.on_true).toEqual(['227:225', 0])
    expect(g['227:226'].inputs.widgets_values).toBeUndefined()
    // 父级对实例输出的引用重写为内部节点输出
    expect(g['230'].inputs.steps).toEqual(['227:226', 0])
  })

  it('aligns instance widget values to exposed widget entries when boundary links precede them', () => {
    const ui = {
      nodes: [
        {
          id: 227,
          type: 'sg-exposed',
          mode: 0,
          inputs: [
            { name: 'ref_images', type: 'IMAGE', link: 2 },
            { name: 'width', type: 'INT', link: 3 },
            { name: 'height', type: 'INT', link: 4 },
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' } },
            { name: 'clip_name', type: 'STRING', widget: { name: 'clip_name' } },
            { name: 'vae_name', type: 'STRING', widget: { name: 'vae_name' } },
            { name: 'value', type: 'FLOAT', widget: { name: 'value' } },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          widgets_values: [
            '黄昏提示',
            'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
            'minimax_h3_video_vae_fp16.safetensors',
            8,
          ],
        },
        {
          id: 115,
          type: 'ResolutionSelector',
          mode: 0,
          inputs: [],
          outputs: [
            { name: 'width', links: [3] },
            { name: 'height', links: [4] },
          ],
          widgets_values: ['16:9 (Widescreen)', 0.4, 32],
        },
        {
          id: 228,
          type: 'LoadImage',
          mode: 0,
          inputs: [
            { name: 'image', type: 'IMAGEUPLOAD', widget: { name: 'image' } },
            { name: 'upload', type: 'IMAGEUPLOAD', widget: { name: 'upload' } },
          ],
          widgets_values: ['Qwen-Image-2512_00013_.png [output]', 'image'],
          outputs: [{ name: 'IMAGE', links: [2] }],
        },
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [
            { name: 'video', type: 'IMAGE', link: 1 },
            { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' } },
            { name: 'format', type: 'COMBO', widget: { name: 'format' } },
          ],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
      ],
      links: [
        [1, 227, 0, 92, 0, 'IMAGE'],
        [2, 228, 0, 227, 0, 'IMAGE'],
        [3, 115, 0, 227, 1, 'INT'],
        [4, 115, 1, 227, 2, 'INT'],
      ],
      definitions: {
        subgraphs: [
          {
            id: 'sg-exposed',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [
              { name: 'ref_images', linkIds: [21] },
              { name: 'width', linkIds: [22] },
              { name: 'height', linkIds: [23] },
            ],
            outputs: [{ name: 'IMAGE', linkIds: [10] }],
            nodes: [
              {
                id: 215,
                type: 'MiniMaxH3ReferenceToVideo',
                mode: 0,
                inputs: [
                  { name: 'ref_images.ref_image_0', type: 'IMAGE', link: 21 },
                  { name: 'width', type: 'INT', link: 22 },
                  { name: 'height', type: 'INT', link: 23 },
                  { name: 'length', type: 'INT', link: 25 },
                  { name: 'prompt', type: 'STRING' },
                ],
                widgets_values: [],
                outputs: [{ name: 'IMAGE', links: [10] }],
              },
              {
                id: 212,
                type: 'CLIPLoader',
                mode: 0,
                inputs: [
                  { name: 'clip_name', type: 'COMBO', link: 30 },
                  { name: 'type', type: 'COMBO' },
                  { name: 'device', type: 'COMBO' },
                ],
                widgets_values: ['占位', 'minimax', 'default'],
                outputs: [],
              },
              {
                id: 214,
                type: 'VAELoader',
                mode: 0,
                inputs: [{ name: 'vae_name', type: 'COMBO' }],
                widgets_values: [],
                outputs: [],
              },
              {
                id: 224,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT' }],
                widgets_values: [20],
                outputs: [],
              },
              {
                id: 225,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT' }],
                widgets_values: [4],
                outputs: [],
              },
              {
                id: 132,
                type: 'PrimitiveFloat',
                mode: 0,
                inputs: [{ name: 'value', type: 'FLOAT' }],
                widgets_values: [],
                outputs: [],
              },
              {
                id: 131,
                type: 'ComfyMathExpression',
                mode: 0,
                inputs: [
                  { name: 'values.a', type: 'FLOAT', link: 26 },
                  { name: 'expression', type: 'STRING' },
                ],
                widgets_values: ['max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17'],
                outputs: [{ name: 'length', links: [25] }],
              },
            ],
            links: [
              { id: 21, origin_id: -10, origin_slot: 0, target_id: 215, target_slot: 0, type: 'IMAGE' },
              { id: 22, origin_id: -10, origin_slot: 1, target_id: 215, target_slot: 1, type: 'INT' },
              { id: 23, origin_id: -10, origin_slot: 2, target_id: 215, target_slot: 2, type: 'INT' },
              { id: 25, origin_id: 131, origin_slot: 1, target_id: 215, target_slot: 3, type: 'INT' },
              { id: 26, origin_id: 132, origin_slot: 0, target_id: 131, target_slot: 0, type: 'FLOAT' },
              { id: 10, origin_id: 215, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
              { id: 30, origin_id: -10, origin_slot: 4, target_id: 212, target_slot: 0, type: 'COMBO' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 实例 widgets_values 按暴露的 widget 输入顺序对齐（边界链接在前不占位）
    expect(g['227:215'].inputs.prompt).toBe('黄昏提示')
    expect(g['227:212'].inputs.clip_name).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
    expect(g['227:212'].inputs.type).toBe('minimax')
    expect(g['227:212'].inputs.device).toBe('default')
    expect(g['227:214'].inputs.vae_name).toBe('minimax_h3_video_vae_fp16.safetensors')
    // 同名 value 优先填充无自身值的 PrimitiveFloat，而不是已带默认值的 PrimitiveInt
    expect(g['227:132'].inputs.value).toBe(8)
    expect(g['227:224'].inputs.value).toBe(20)
    expect(g['227:225'].inputs.value).toBe(4)
    expect(g['227:131'].inputs['values.a']).toEqual(['227:132', 0])
  })

  it('injects exposed subgraph widget values through -10 boundary links like the MiniMax H3 workflow', () => {
    // 忠实还原 ComfyUI 子图序列化：def.inputs 暴露 prompt/时长/模型名/开关等参数，
    // 实例无链接、值在 widgets_values，内部节点输入经 -10 边界接收
    const ui = {
      nodes: [
        {
          id: 227,
          type: '628aea62-54d3-40b8-8b8b-5b648feab266',
          mode: 0,
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null },
            { name: 'width', type: 'INT', widget: { name: 'width' }, link: 507 },
            { name: 'height', type: 'INT', widget: { name: 'height' }, link: 508 },
            { name: 'value', type: 'FLOAT', widget: { name: 'value' }, link: null },
            { name: 'unet_name', type: 'COMBO', widget: { name: 'unet_name' }, link: null },
            { name: 'type', type: 'COMBO', widget: { name: 'type' }, link: null },
            { name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' }, link: null },
            { name: 'vae_name_1', type: 'COMBO', widget: { name: 'vae_name_1' }, link: null },
            { name: 'switch', type: 'BOOLEAN', widget: { name: 'switch' }, link: null },
            { name: 'lora_name', type: 'COMBO', widget: { name: 'lora_name' }, link: null },
            { name: 'ref_images.ref_image_0', type: 'IMAGE', link: 511 },
          ],
          outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [477] }],
          widgets_values: [
            '使用<ref_image_0>作为严格的角色参考',
            1344,
            768,
            5,
            'minimax_h3_ref2va_pruned_nvfp4.safetensors',
            'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
            'minimax_h3_video_vae_fp16.safetensors',
            'minimax_h3_audio_vae_fp32.safetensors',
            false,
            'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
          ],
        },
        {
          id: 115,
          type: 'ResolutionSelector',
          mode: 0,
          inputs: [],
          outputs: [
            { name: 'width', links: [507] },
            { name: 'height', links: [508] },
          ],
          widgets_values: ['16:9 (Widescreen)', 0.4, 32],
        },
        {
          id: 228,
          type: 'LoadImage',
          mode: 0,
          inputs: [],
          widgets_values: ['Qwen-Image-2512_00013_.png [output]', 'image'],
          outputs: [{ name: 'IMAGE', links: [511] }],
        },
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [{ name: 'video', type: 'VIDEO', link: 477 }],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
      ],
      links: [
        [477, 227, 0, 92, 0, 'VIDEO'],
        [507, 115, 0, 227, 1, 'INT'],
        [508, 115, 1, 227, 2, 'INT'],
        [511, 228, 0, 227, 10, 'IMAGE'],
      ],
      definitions: {
        subgraphs: [
          {
            id: '628aea62-54d3-40b8-8b8b-5b648feab266',
            name: 'Refine to Video (MiniMaxH3)',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [
              { name: 'prompt', linkIds: [504] },
              { name: 'width', linkIds: [505] },
              { name: 'height', linkIds: [506] },
              { name: 'value', linkIds: [503] },
              { name: 'unet_name', linkIds: [496] },
              { name: 'type', linkIds: [498] },
              { name: 'vae_name', linkIds: [499] },
              { name: 'vae_name_1', linkIds: [500] },
              { name: 'switch', linkIds: [501, 502] },
              { name: 'lora_name', linkIds: [510] },
              { name: 'ref_images.ref_image_0', linkIds: [474] },
            ],
            outputs: [{ name: 'VIDEO', linkIds: [475] }],
            nodes: [
              {
                id: 211,
                type: 'UNETLoader',
                mode: 0,
                inputs: [
                  { name: 'unet_name', type: 'COMBO', widget: { name: 'unet_name' }, link: 496 },
                  { name: 'weight_dtype', type: 'COMBO', widget: { name: 'weight_dtype' }, link: null },
                ],
                widgets_values: ['占位', 'default'],
                outputs: [],
              },
              {
                id: 212,
                type: 'CLIPLoader',
                mode: 0,
                inputs: [
                  { name: 'clip_name', type: 'COMBO', widget: { name: 'clip_name' }, link: 498 },
                  { name: 'type', type: 'COMBO', widget: { name: 'type' }, link: null },
                  { name: 'device', type: 'COMBO', widget: { name: 'device' }, link: null },
                ],
                widgets_values: ['占位', 'minimax', 'default'],
                outputs: [],
              },
              {
                id: 213,
                type: 'VAELoader',
                mode: 0,
                inputs: [{ name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' }, link: 499 }],
                widgets_values: ['占位'],
                outputs: [],
              },
              {
                id: 214,
                type: 'VAELoader',
                mode: 0,
                inputs: [{ name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' }, link: 500 }],
                widgets_values: ['占位'],
                outputs: [],
              },
              {
                id: 209,
                type: 'LoraLoaderModelOnly',
                mode: 0,
                inputs: [
                  { name: 'model', type: 'MODEL', link: 451 },
                  { name: 'lora_name', type: 'COMBO', widget: { name: 'lora_name' }, link: 510 },
                  { name: 'strength_model', type: 'FLOAT', widget: { name: 'strength_model' }, link: null },
                ],
                widgets_values: ['占位', 1],
                outputs: [],
              },
              {
                id: 210,
                type: 'ComfySwitchNode',
                mode: 0,
                inputs: [
                  { name: 'on_false', type: 'MODEL', link: 452 },
                  { name: 'on_true', type: 'MODEL', link: 453 },
                  { name: 'switch', type: 'BOOLEAN', widget: { name: 'switch' }, link: 501 },
                ],
                widgets_values: [true],
                outputs: [],
              },
              {
                id: 226,
                type: 'ComfySwitchNode',
                mode: 0,
                inputs: [
                  { name: 'on_false', type: 'INT', link: 472 },
                  { name: 'on_true', type: 'INT', link: 473 },
                  { name: 'switch', type: 'BOOLEAN', widget: { name: 'switch' }, link: 502 },
                ],
                widgets_values: [true],
                outputs: [],
              },
              {
                id: 224,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT', widget: { name: 'value' }, link: null }],
                widgets_values: [20, 'fixed'],
                outputs: [],
              },
              {
                id: 225,
                type: 'PrimitiveInt',
                mode: 0,
                inputs: [{ name: 'value', type: 'INT', widget: { name: 'value' }, link: null }],
                widgets_values: [4, 'fixed'],
                outputs: [],
              },
              {
                id: 132,
                type: 'PrimitiveFloat',
                mode: 0,
                inputs: [{ name: 'value', type: 'FLOAT', widget: { name: 'value' }, link: 503 }],
                widgets_values: [3],
                outputs: [],
              },
              {
                id: 131,
                type: 'ComfyMathExpression',
                mode: 0,
                inputs: [
                  { name: 'values.a', type: 'FLOAT,INT,BOOLEAN', link: 261 },
                  { name: 'expression', type: 'STRING', widget: { name: 'expression' }, link: null },
                ],
                widgets_values: ['max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17'],
                outputs: [],
              },
              {
                id: 215,
                type: 'MiniMaxH3ReferenceToVideo',
                mode: 0,
                inputs: [
                  { name: 'clip', type: 'CLIP', link: 454 },
                  { name: 'vae', type: 'VAE', link: 455 },
                  { name: 'audio_vae', type: 'VAE', link: 456 },
                  { name: 'ref_images.ref_image_0', type: 'IMAGE', link: 474 },
                  { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: 504 },
                  { name: 'width', type: 'INT', widget: { name: 'width' }, link: 505 },
                  { name: 'height', type: 'INT', widget: { name: 'height' }, link: 506 },
                  { name: 'length', type: 'INT', widget: { name: 'length' }, link: 478 },
                  { name: 'ref_image_size', type: 'COMBO', widget: { name: 'ref_image_size' }, link: null },
                ],
                widgets_values: ['', 1344, 768, 124, 'match'],
                outputs: [{ name: 'VIDEO', links: [475] }],
              },
            ],
            links: [
              { id: 451, origin_id: 211, origin_slot: 0, target_id: 209, target_slot: 0, type: 'MODEL' },
              { id: 452, origin_id: 211, origin_slot: 0, target_id: 210, target_slot: 0, type: 'MODEL' },
              { id: 453, origin_id: 209, origin_slot: 0, target_id: 210, target_slot: 1, type: 'MODEL' },
              { id: 454, origin_id: 212, origin_slot: 0, target_id: 215, target_slot: 0, type: 'CLIP' },
              { id: 455, origin_id: 213, origin_slot: 0, target_id: 215, target_slot: 1, type: 'VAE' },
              { id: 456, origin_id: 214, origin_slot: 0, target_id: 215, target_slot: 2, type: 'VAE' },
              { id: 472, origin_id: 224, origin_slot: 0, target_id: 226, target_slot: 0, type: 'INT' },
              { id: 473, origin_id: 225, origin_slot: 0, target_id: 226, target_slot: 1, type: 'INT' },
              { id: 261, origin_id: 132, origin_slot: 0, target_id: 131, target_slot: 0, type: 'FLOAT' },
              { id: 474, origin_id: -10, origin_slot: 10, target_id: 215, target_slot: 3, type: 'IMAGE' },
              { id: 475, origin_id: 215, origin_slot: 0, target_id: -20, target_slot: 0, type: 'VIDEO' },
              { id: 478, origin_id: 131, origin_slot: 1, target_id: 215, target_slot: 7, type: 'INT' },
              { id: 496, origin_id: -10, origin_slot: 4, target_id: 211, target_slot: 0, type: 'COMBO' },
              { id: 498, origin_id: -10, origin_slot: 5, target_id: 212, target_slot: 0, type: 'COMBO' },
              { id: 499, origin_id: -10, origin_slot: 6, target_id: 213, target_slot: 0, type: 'COMBO' },
              { id: 500, origin_id: -10, origin_slot: 7, target_id: 214, target_slot: 0, type: 'COMBO' },
              { id: 501, origin_id: -10, origin_slot: 8, target_id: 210, target_slot: 2, type: 'BOOLEAN' },
              { id: 502, origin_id: -10, origin_slot: 8, target_id: 226, target_slot: 2, type: 'BOOLEAN' },
              { id: 503, origin_id: -10, origin_slot: 3, target_id: 132, target_slot: 0, type: 'FLOAT' },
              { id: 504, origin_id: -10, origin_slot: 0, target_id: 215, target_slot: 4, type: 'STRING' },
              { id: 505, origin_id: -10, origin_slot: 1, target_id: 215, target_slot: 5, type: 'INT' },
              { id: 506, origin_id: -10, origin_slot: 2, target_id: 215, target_slot: 6, type: 'INT' },
              { id: 510, origin_id: -10, origin_slot: 9, target_id: 209, target_slot: 1, type: 'COMBO' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 暴露的 widget 值经 -10 边界注入内部节点
    expect(g['227:215'].inputs.prompt).toBe('使用<ref_image_0>作为严格的角色参考')
    expect(g['227:215'].inputs.width).toEqual(['115', 0])
    expect(g['227:215'].inputs.height).toEqual(['115', 1])
    expect(g['227:215'].inputs['ref_images.ref_image_0']).toEqual(['228', 0])
    expect(g['227:215'].inputs.length).toEqual(['227:131', 1])
    expect(g['227:132'].inputs.value).toBe(5)
    expect(g['227:211'].inputs.unet_name).toBe('minimax_h3_ref2va_pruned_nvfp4.safetensors')
    expect(g['227:211'].inputs.weight_dtype).toBe('default')
    expect(g['227:212'].inputs.clip_name).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
    expect(g['227:212'].inputs.type).toBe('minimax')
    expect(g['227:212'].inputs.device).toBe('default')
    expect(g['227:213'].inputs.vae_name).toBe('minimax_h3_video_vae_fp16.safetensors')
    expect(g['227:214'].inputs.vae_name).toBe('minimax_h3_audio_vae_fp32.safetensors')
    expect(g['227:209'].inputs.lora_name).toBe('minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors')
    expect(g['227:209'].inputs.strength_model).toBe(1)
    expect(g['227:210'].inputs.switch).toBe(false)
    expect(g['227:226'].inputs.switch).toBe(false)
    // 时长提升不得误覆盖 steps 用的 PrimitiveInt
    expect(g['227:224'].inputs.value).toBe(20)
    expect(g['227:225'].inputs.value).toBe(4)
    expect(g['227:131'].inputs['values.a']).toEqual(['227:132', 0])
    expect(g['92'].inputs.video).toEqual(['227:215', 0])
  })

  it('keeps widget positions aligned when a legacy loader input is linked but unresolved', () => {
    const ui = {
      nodes: [
        {
          id: 227,
          type: 'sg-loader',
          mode: 0,
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          widgets_values: [],
        },
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [{ name: 'video', type: 'IMAGE', link: 1 }],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
      ],
      links: [[1, 227, 0, 92, 0, 'IMAGE']],
      definitions: {
        subgraphs: [
          {
            id: 'sg-loader',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'IMAGE', linkIds: [10] }],
            nodes: [
              {
                id: 212,
                type: 'CLIPLoader',
                mode: 0,
                inputs: [
                  { name: 'clip_name', type: 'COMBO', link: 30 },
                  { name: 'type', type: 'COMBO' },
                  { name: 'device', type: 'COMBO' },
                ],
                // 旧式序列化：已连线的 clip_name 在 widgets_values 中保留占位值
                widgets_values: ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'minimax', 'default'],
                outputs: [{ name: 'IMAGE', links: [10] }],
              },
            ],
            links: [
              { id: 30, origin_id: 999, origin_slot: 0, target_id: 212, target_slot: 0, type: 'STRING' },
              { id: 10, origin_id: 212, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // clip_name 链路无法解析时保持缺失，但 type/device 不得因占位值而错位
    expect(g['227:212'].inputs.clip_name).toBeUndefined()
    expect(g['227:212'].inputs.type).toBe('minimax')
    expect(g['227:212'].inputs.device).toBe('default')
  })

  it('keeps widget positions aligned for new-format linked loader inputs with retained placeholders', () => {
    const ui = {
      nodes: [
        {
          id: 227,
          type: 'sg-loader2',
          mode: 0,
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          widgets_values: [],
        },
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [{ name: 'video', type: 'IMAGE', link: 1 }],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
      ],
      links: [[1, 227, 0, 92, 0, 'IMAGE']],
      definitions: {
        subgraphs: [
          {
            id: 'sg-loader2',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'IMAGE', linkIds: [10] }],
            nodes: [
              {
                id: 212,
                type: 'CLIPLoader',
                mode: 0,
                inputs: [
                  { name: 'clip_name', type: 'COMBO', link: 30 },
                  { name: 'type', type: 'COMBO', widget: { name: 'type' } },
                  { name: 'device', type: 'COMBO', widget: { name: 'device' } },
                ],
                // 新格式 + 旧占位混合：已连线的 clip_name 占位值仍留在 widgets_values 首位
                widgets_values: ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'minimax', 'default'],
                outputs: [{ name: 'IMAGE', links: [10] }],
              },
            ],
            links: [
              { id: 30, origin_id: 999, origin_slot: 0, target_id: 212, target_slot: 0, type: 'STRING' },
              { id: 10, origin_id: 212, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // clip_name 链路无法解析时保持缺失，但 type/device 不得因首位占位值而错位
    expect(g['227:212'].inputs.clip_name).toBeUndefined()
    expect(g['227:212'].inputs.type).toBe('minimax')
    expect(g['227:212'].inputs.device).toBe('default')
  })

  it('skips hoisting gracefully when an exposed widget name matches no inner node', () => {
    const ui = {
      nodes: [
        {
          id: 227,
          type: 'sg-nomatch',
          mode: 0,
          inputs: [
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' } },
            { name: 'no_such_param', type: 'STRING', widget: { name: 'no_such_param' } },
          ],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          widgets_values: ['提示文本', '不存在'],
        },
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [{ name: 'video', type: 'IMAGE', link: 1 }],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
      ],
      links: [[1, 227, 0, 92, 0, 'IMAGE']],
      definitions: {
        subgraphs: [
          {
            id: 'sg-nomatch',
            inputNode: { id: -10 },
            outputNode: { id: -20 },
            inputs: [],
            outputs: [{ name: 'IMAGE', linkIds: [10] }],
            nodes: [
              {
                id: 215,
                type: 'MiniMaxH3ReferenceToVideo',
                mode: 0,
                inputs: [{ name: 'prompt', type: 'STRING' }],
                widgets_values: [],
                outputs: [{ name: 'IMAGE', links: [10] }],
              },
            ],
            links: [
              { id: 10, origin_id: 215, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
            ],
          },
        ],
      },
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui))
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    // 能匹配的照常提升；匹配不到的名字不抛异常、不产生覆盖
    expect(g['227:215'].inputs.prompt).toBe('提示文本')
    expect(g['227:215'].inputs.no_such_param).toBeUndefined()
  })

  it('ignores UI-only leftover values for SaveVideo and LoadVideo', () => {
    const ui = {
      nodes: [
        {
          id: 92,
          type: 'SaveVideo',
          mode: 0,
          inputs: [
            { name: 'video', type: 'IMAGE', link: 1 },
            { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' } },
            { name: 'format', type: 'COMBO', widget: { name: 'format' } },
          ],
          widgets_values: ['video/MiniMax_H3', 'auto', 'auto'],
          outputs: [],
        },
        {
          id: 154,
          type: 'LoadVideo',
          mode: 0,
          inputs: [{ name: 'file', type: 'VIDEOFILE', widget: { name: 'file' } }],
          widgets_values: ['b85af5de763881aee71ef0d8c1b9b17a.mp4', 'image'],
          outputs: [],
        },
        { id: 105, type: 'VAEDecode', mode: 0, inputs: [], widgets_values: [], outputs: [] },
      ],
      links: [[1, 105, 0, 92, 0, 'IMAGE']],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui), {
      objectInfo: {
        SaveVideo: {
          input: {
            required: {
              video: ['IMAGE'],
              filename_prefix: ['STRING'],
              format: ['COMBO'],
            },
            optional: {},
          },
        },
        LoadVideo: {
          input: { required: { file: ['VIDEOFILE'] }, optional: {} },
        },
      },
    })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    expect(g['92'].inputs.filename_prefix).toBe('video/MiniMax_H3')
    expect(g['92'].inputs.format).toBe('auto')
    expect(g['154'].inputs.file).toBe('b85af5de763881aee71ef0d8c1b9b17a.mp4')
    expect(g['154'].inputs.widgets_values).toBeUndefined()
  })

  it('returns a clear error for invalid JSON', () => {
    const result = convertWorkflowJsonToApiGraph('{oops')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('解析失败')
  })
})
