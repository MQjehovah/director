import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import WorkflowTemplateManager from '../WorkflowTemplateManager.vue'
import {
  listWorkflowTemplates,
  saveWorkflowTemplate,
} from '../../comfyui/workflowStore'
import { loadProviderConfig, saveProviderConfig } from '../httpBackendConfig'
import { MEDIA_COMFYUI_ID } from '../../../plugins/providers/media-comfyui'

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

describe('WorkflowTemplateManager', () => {
  beforeEach(() => {
    localStorage.clear()
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

  it('lists saved templates and deletes one', async () => {
    saveWorkflowTemplate({ id: 'keep', name: '保留', graphJson: '{}' })
    saveWorkflowTemplate({ id: 'gone', name: '删除', graphJson: '{}' })
    const w = mount(WorkflowTemplateManager)
    expect(w.findAll('[data-test="wf-template-item"]')).toHaveLength(2)
    await w.findAll('[data-test="wf-delete"]')[1].trigger('click')
    expect(listWorkflowTemplates().map((t) => t.id)).toEqual(['keep'])
  })

  it('sets a template as the current comfyui provider template', async () => {
    saveWorkflowTemplate({ id: 'cur', name: '当前模板', graphJson: '{}' })
    const w = mount(WorkflowTemplateManager)
    await w.get('[data-test="wf-use"]').trigger('click')
    expect(loadProviderConfig(MEDIA_COMFYUI_ID)?.workflowTemplateId).toBe('cur')
  })

  it('设为当前 preserves the existing provider config (baseUrl 等不被覆盖)', async () => {
    saveProviderConfig(MEDIA_COMFYUI_ID, { baseUrl: 'http://127.0.0.1:8188', apiKey: 'sk-x' })
    saveWorkflowTemplate({ id: 'cur', name: '当前模板', graphJson: '{}' })
    const w = mount(WorkflowTemplateManager)
    await w.get('[data-test="wf-use"]').trigger('click')
    const config = loadProviderConfig(MEDIA_COMFYUI_ID)
    expect(config?.workflowTemplateId).toBe('cur')
    expect(config?.baseUrl).toBe('http://127.0.0.1:8188')
    expect(config?.apiKey).toBe('sk-x')
  })
})
