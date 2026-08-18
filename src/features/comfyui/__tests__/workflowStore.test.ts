import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  deleteWorkflowTemplate,
  getWorkflowTemplate,
  importWorkflowGraph,
  listWorkflowTemplates,
  saveWorkflowTemplate,
} from '../workflowStore'
import { DEFAULT_TXT2IMG_WORKFLOW } from '../../../plugins/providers/media-comfyui'

describe('workflowStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects positive prompt, negative, and seed nodes from a linked graph', () => {
    const result = importWorkflowGraph(
      JSON.stringify({
        '3': {
          class_type: 'KSampler',
          inputs: { seed: 42, positive: ['6', 0], negative: ['7', 0] },
        },
        '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
        '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
      }),
      't1',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBe('6')
    expect(result.negativeNodeId).toBe('7')
    expect(result.seedNodeId).toBe('3')
    expect(result.name).toBe('t1')
    expect(result.graphJson).toContain('CLIPTextEncode')
  })

  it('detects the built-in placeholder workflow nodes', () => {
    const result = importWorkflowGraph(DEFAULT_TXT2IMG_WORKFLOW, '默认')
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBe('6')
    expect(result.negativeNodeId).toBe('7')
    expect(result.seedNodeId).toBe('3')
  })

  it('falls back to the first CLIPTextEncode when no KSampler link exists', () => {
    const result = importWorkflowGraph(
      JSON.stringify({
        '10': { class_type: 'CLIPTextEncode', inputs: { text: 'a' } },
        '11': { class_type: 'CLIPTextEncode', inputs: { text: 'b' } },
      }),
      't',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBe('10')
    expect(result.negativeNodeId).toBeUndefined()
    expect(result.seedNodeId).toBeUndefined()
  })

  it('creates a template without promptNodeId when there is no CLIPTextEncode', () => {
    const result = importWorkflowGraph(
      JSON.stringify({
        '3': { class_type: 'KSampler', inputs: { seed: 1, positive: ['8', 0] } },
        '8': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
      }),
      't',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBeUndefined()
    expect(result.seedNodeId).toBe('3')
  })

  it('detects custom prompt nodes and RandomNoise seed (MiniMax style)', () => {
    const result = importWorkflowGraph(
      JSON.stringify({
        '134': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
        '105:15': { class_type: 'RandomNoise', inputs: { noise_seed: 123 } },
        '105:104': {
          class_type: 'MiniMaxH3ImageToVideo',
          inputs: { prompt: '道士说话', first_frame: ['134', 0] },
        },
      }),
      't',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBe('105:104')
    expect(result.seedNodeId).toBe('105:15')
  })

  it('detects negative_prompt inputs on custom/subgraph nodes', () => {
    const result = importWorkflowGraph(
      JSON.stringify({
        '105': {
          class_type: '4c314f31-ecda-4b08-ae98-faaba1bf613f',
          inputs: {
            prompt: '黄昏天台',
            negative_prompt: '低分辨率，画面模糊',
            noise_seed: 768,
          },
        },
      }),
      't',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBe('105')
    expect(result.negativeNodeId).toBe('105')
    expect(result.seedNodeId).toBe('105')
  })

  it('detects prompt/negative/seed nodes in an expanded subgraph graph (values via primitive refs)', () => {
    const result = importWorkflowGraph(
      JSON.stringify({
        '238:9': {
          class_type: 'MiniMaxH3TextToVideo',
          inputs: {
            prompt: ['238:7', 0],
            negative_prompt: ['238:70', 0],
            seed: ['238:8', 0],
          },
        },
        '238:7': { class_type: 'PrimitiveString', inputs: { value: '默认提示' } },
        '238:70': { class_type: 'PrimitiveString', inputs: { value: '' } },
        '238:8': { class_type: 'PrimitiveInt', inputs: { value: 0 } },
      }),
      't',
    )
    if ('error' in result) throw new Error(result.error)
    expect(result.promptNodeId).toBe('238:9')
    expect(result.negativeNodeId).toBe('238:9')
    expect(result.seedNodeId).toBe('238:9')
  })

  it('returns an error for invalid JSON', () => {
    const result = importWorkflowGraph('{oops', 't')
    expect('error' in result).toBe(true)
    expect(result).toHaveProperty('error')
  })

  it('returns an error for non-object JSON', () => {
    const result = importWorkflowGraph('[1,2,3]', 't')
    expect('error' in result).toBe(true)
  })

  it('returns an error when a node lacks class_type', () => {
    const result = importWorkflowGraph(JSON.stringify({ '1': { inputs: { text: 'x' } } }), 't')
    expect('error' in result).toBe(true)
  })

  it('saves and loads templates with an auto-assigned id', () => {
    const tpl = importWorkflowGraph(DEFAULT_TXT2IMG_WORKFLOW, '已保存')
    if ('error' in tpl) throw new Error(tpl.error)
    expect(tpl.id).toBeTruthy()
    saveWorkflowTemplate(tpl)
    expect(getWorkflowTemplate(tpl.id)).toMatchObject({ name: '已保存', promptNodeId: '6' })
    expect(listWorkflowTemplates()).toHaveLength(1)
  })

  it('upserts by id', () => {
    saveWorkflowTemplate({ id: 't1', name: 'old', graphJson: '{}' })
    saveWorkflowTemplate({ id: 't1', name: 'new', graphJson: '{}' })
    expect(listWorkflowTemplates()).toHaveLength(1)
    expect(getWorkflowTemplate('t1')?.name).toBe('new')
  })

  it('deletes a template', () => {
    saveWorkflowTemplate({ id: 't1', name: 'a', graphJson: '{}' })
    saveWorkflowTemplate({ id: 't2', name: 'b', graphJson: '{}' })
    deleteWorkflowTemplate('t1')
    expect(getWorkflowTemplate('t1')).toBeUndefined()
    expect(listWorkflowTemplates().map((t) => t.id)).toEqual(['t2'])
  })

  it('tolerates unavailable localStorage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(listWorkflowTemplates()).toEqual([])
    expect(() => saveWorkflowTemplate({ id: 'x', name: 'x', graphJson: '{}' })).not.toThrow()
    expect(getWorkflowTemplate('x')).toBeUndefined()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
