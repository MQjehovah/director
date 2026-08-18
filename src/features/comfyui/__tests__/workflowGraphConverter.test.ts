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
          type: 'eba40a3a-f6c5-48ac-b58e-55525d06b373',
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
        'eba40a3a-f6c5-48ac-b58e-55525d06b373': {
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
    expect(g['99']).toEqual({ class_type: 'MarkdownNote', inputs: {} })
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

  it('maps new-format subgraph nodes by declared widget names (skipping linked positions)', () => {
    const ui = {
      nodes: [
        {
          id: 105,
          type: '4c314f31-ecda-4b08-ae98-faaba1bf613f',
          mode: 0,
          inputs: [
            { name: 'width', type: 'INT', widget: { name: 'width' }, link: 1 },
            { name: 'height', type: 'INT', widget: { name: 'height' }, link: 2 },
            { name: 'prompt', type: 'STRING', widget: { name: 'prompt' } },
            { name: 'value_1', type: 'INT', widget: { name: 'value_1' } },
            { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' } },
            { name: 'unet_name', type: 'COMBO', widget: { name: 'unet_name' } },
            { name: 'clip_name', type: 'COMBO', widget: { name: 'clip_name' } },
            { name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' } },
            { name: 'vae_name_1', type: 'COMBO', widget: { name: 'vae_name_1' } },
            { name: 'value', type: 'COMBO', widget: { name: 'value' } },
            { name: 'lora_name', type: 'COMBO', widget: { name: 'lora_name' } },
            { name: 'audio', type: 'BOOLEAN', widget: { name: 'audio' } },
            {
              name: 'unet_name_1',
              type: 'COMBO',
              widget: { name: 'unet_name_1' },
            },
          ],
          widgets_values: [
            1280,
            720,
            '高角度俯视的黄昏天台',
            1344,
            768,
            5,
            696168949574765,
            'minimax_h3_fl2va_pruned_nvfp4.safetensors',
            'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
            'minimax_h3_video_vae_fp16.safetensors',
            'minimax_h3_audio_vae_fp32.safetensors',
            true,
            'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
          ],
          outputs: [],
        },
        {
          id: 115,
          type: 'ResolutionSelector',
          mode: 0,
          inputs: [],
          widgets_values: ['16:9 (Widescreen)', 0.4, 32],
          outputs: [],
        },
      ],
      links: [
        [1, 115, 0, 105, 0, 'INT'],
        [2, 115, 1, 105, 1, 'INT'],
      ],
    }
    const result = convertWorkflowJsonToApiGraph(JSON.stringify(ui), {
      objectInfo: {
        '4c314f31-ecda-4b08-ae98-faaba1bf613f': {
          input: {
            required: {
              width: ['INT'],
              height: ['INT'],
              prompt: ['STRING'],
              value_1: ['INT'],
              noise_seed: ['INT'],
              unet_name: ['COMBO'],
              clip_name: ['COMBO'],
              vae_name: ['COMBO'],
              vae_name_1: ['COMBO'],
              value: ['COMBO'],
              lora_name: ['COMBO'],
              audio: ['BOOLEAN'],
              unet_name_1: ['COMBO'],
            },
            optional: {},
          },
        },
      },
    })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    const g = result.graph!
    expect(g['105'].inputs.width).toEqual(['115', 0])
    expect(g['105'].inputs.height).toEqual(['115', 1])
    expect(g['105'].inputs.prompt).toBe('高角度俯视的黄昏天台')
    expect(g['105'].inputs.unet_name).toBe(5)
    expect(g['105'].inputs.clip_name).toBe(696168949574765)
    expect(g['105'].inputs.vae_name).toBe('minimax_h3_fl2va_pruned_nvfp4.safetensors')
    expect(g['105'].inputs.audio).toBe(true)
    expect(g['105'].inputs.unet_name_1).toBe(
      'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
    )
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
