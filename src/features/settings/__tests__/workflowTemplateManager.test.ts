import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import WorkflowTemplateManager from '../WorkflowTemplateManager.vue'
import {
  listWorkflowTemplates,
  saveWorkflowTemplate,
} from '../../comfyui/workflowStore'

function linkedGraphJson(): string {
  return JSON.stringify({
    '3': {
      class_type: 'KSampler',
      inputs: { seed: 42, steps: 20, positive: ['6', 0], negative: ['7', 0] },
    },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['4', 1] } },
  })
}

function uiFormatWorkflowJson(): string {
  return JSON.stringify({
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
      {
        id: 7,
        type: 'CLIPTextEncode',
        mode: 0,
        inputs: [{ name: 'clip', type: 'CLIP', link: 5 }],
        widgets_values: ['neg'],
        outputs: [],
      },
      {
        id: 4,
        type: 'CheckpointLoaderSimple',
        mode: 0,
        inputs: [],
        widgets_values: ['model.safetensors'],
        outputs: [],
      },
    ],
    links: [
      [1, 4, 0, 3, 0, 'MODEL'],
      [2, 6, 0, 3, 1, 'CONDITIONING'],
      [3, 7, 0, 3, 2, 'CONDITIONING'],
      [5, 4, 1, 6, 0, 'CLIP'],
    ],
  })
}

describe('WorkflowTemplateManager', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('imports a workflow, detects node ids, and saves the template', async () => {
    const w = mount(WorkflowTemplateManager)
    await w.get('[data-test="wf-name"]').setValue('我的工作流')
    await w.get('[data-test="wf-graph"]').setValue(linkedGraphJson())
    await w.get('[data-test="wf-import"]').trigger('click')

    expect(w.get('[data-test="wf-detected"]').text()).toContain('6')
    expect(w.find('[data-test="wf-save"]').exists()).toBe(true)

    await w.get('[data-test="wf-save"]').trigger('click')
    const templates = listWorkflowTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0]).toMatchObject({
      name: '我的工作流',
      promptNodeId: '6',
      negativeNodeId: '7',
      seedNodeId: '3',
    })
  })

  it('rejects invalid JSON with an error message and saves nothing', async () => {
    const w = mount(WorkflowTemplateManager)
    await w.get('[data-test="wf-name"]').setValue('bad')
    await w.get('[data-test="wf-graph"]').setValue('{oops')
    await w.get('[data-test="wf-import"]').trigger('click')
    expect(w.get('[data-test="wf-message"]').text()).toContain('解析失败')
    expect(listWorkflowTemplates()).toEqual([])
  })

  it('imports a workflow from a local json file', async () => {
    const w = mount(WorkflowTemplateManager)
    const input = w.get('[data-test="wf-file-input"]')
    const file = { name: '本地工作流.json', text: async () => linkedGraphJson() } as unknown as File
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(w.get('[data-test="wf-detected"]').text()).toContain('6')
    await w.get('[data-test="wf-save"]').trigger('click')
    const templates = listWorkflowTemplates()
    expect(templates).toHaveLength(1)
    expect(templates[0].name).toBe('本地工作流')
    expect(templates[0].promptNodeId).toBe('6')
    expect(templates[0].seedNodeId).toBe('3')
  })

  it('imports a UI-format workflow file (nodes/links) and converts it to API format', async () => {
    const w = mount(WorkflowTemplateManager)
    const input = w.get('[data-test="wf-file-input"]')
    const file = {
      name: '前端格式.json',
      text: async () => uiFormatWorkflowJson(),
    } as unknown as File
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(w.get('[data-test="wf-detected"]').text()).toContain('6')
    expect(w.get('[data-test="wf-detected"]').text()).toContain('7')
    await w.get('[data-test="wf-save"]').trigger('click')
    const templates = listWorkflowTemplates()
    expect(templates).toHaveLength(1)
    const saved = JSON.parse(templates[0].graphJson) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    expect(saved['6'].inputs.text).toBe('hello')
    expect(saved['3'].inputs.seed).toBe(42)
    expect(saved['3'].inputs.positive).toEqual(['6', 0])
    expect(saved['3'].inputs.negative).toEqual(['7', 0])
  })

  it('lists saved templates and deletes one', async () => {
    saveWorkflowTemplate({ id: 'keep', name: '保留', graphJson: '{}' })
    saveWorkflowTemplate({ id: 'gone', name: '删除', graphJson: '{}' })
    const w = mount(WorkflowTemplateManager)
    expect(w.findAll('[data-test="wf-template-item"]')).toHaveLength(2)
    await w.findAll('[data-test="wf-delete"]')[1].trigger('click')
    expect(listWorkflowTemplates().map((t) => t.id)).toEqual(['keep'])
  })

  it('badges stale templates whose CLIPLoader type was shifted to a model filename', async () => {
    saveWorkflowTemplate({ id: 'fresh', name: '新模板', graphJson: '{}' })
    saveWorkflowTemplate({
      id: 'stale',
      name: '旧模板',
      graphJson: JSON.stringify({
        '227:212': {
          class_type: 'CLIPLoader',
          inputs: { type: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', device: 'minimax' },
        },
      }),
    })
    const w = mount(WorkflowTemplateManager)
    const badges = w.findAll('[data-test="wf-stale-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0].text()).toContain('旧版本')
    // 旧模板的删除按钮在第二个模板条目上
    await w.findAll('[data-test="wf-delete"]')[1].trigger('click')
    expect(listWorkflowTemplates().map((t) => t.id)).toEqual(['fresh'])
  })

  it('repairs and imports an expanded API graph with stale shifted CLIPLoader values', async () => {
    const w = mount(WorkflowTemplateManager)
    await w.get('[data-test="wf-graph"]').setValue(
      JSON.stringify({
        '227:212': {
          class_type: 'CLIPLoader',
          inputs: { type: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', device: 'minimax' },
        },
        '227:214': {
          class_type: 'VAELoader',
          inputs: { widgets_values: ['minimax_h3_audio_vae_fp32.safetensors'] },
        },
        '227:132': {
          class_type: 'PrimitiveFloat',
          inputs: { widgets_values: [5] },
        },
      }),
    )
    await w.get('[data-test="wf-import"]').trigger('click')
    expect(w.get('[data-test="wf-warnings"]').text()).toContain('自动修复')
    await w.get('[data-test="wf-save"]').trigger('click')
    const templates = listWorkflowTemplates()
    expect(templates).toHaveLength(1)
    const saved = JSON.parse(templates[0].graphJson) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    expect(saved['227:212'].inputs.clip_name).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
    expect(saved['227:212'].inputs.type).toBe('minimax')
    expect(saved['227:212'].inputs.device).toBe('default')
    expect(saved['227:214'].inputs.vae_name).toBe('minimax_h3_audio_vae_fp32.safetensors')
    expect(saved['227:132'].inputs.value).toBe(5)
  })

  it('fetches and imports workflows from a ComfyUI address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url)
        if (u.includes('/api/workflows?')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'wf-1', name: '远程工作流' }] }),
          } as unknown as Response)
        }
        if (u.includes('/api/workflows/wf-1/content')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ workflow_json: JSON.parse(linkedGraphJson()) }),
          } as unknown as Response)
        }
        if (u.endsWith('/object_info')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({}),
          } as unknown as Response)
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        } as unknown as Response)
      }),
    )
    const w = mount(WorkflowTemplateManager)
    await w.get('[data-test="wf-remote-toggle"]').trigger('click')
    await w.get('[data-test="wf-remote-url"]').setValue('http://127.0.0.1:8188')
    await w.get('[data-test="wf-remote-fetch"]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-test="wf-remote-item"]')).toHaveLength(1)
    expect(w.get('[data-test="wf-message"]').text()).toContain('1 个工作流')

    await w.get('[data-test="wf-remote-import"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="wf-message"]').text()).toContain('导入并保存')
    // 拉取导入直接保存，不再需要二次点击「保存模板」
    expect(listWorkflowTemplates().map((t) => t.name)).toContain('远程工作流')

    // 「原始」按钮把 ComfyUI 返回的未转换 JSON 填入文本框
    await w.get('[data-test="wf-remote-raw"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="wf-message"]').text()).toContain('原始工作流 JSON')
  })
})
