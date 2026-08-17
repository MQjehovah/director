import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  comfyuiWorkflowSkills,
  workflowPurpose,
  workflowSkillDescription,
} from '../comfyuiSkills'
import { saveWorkflowTemplate } from '../../../comfyui/workflowStore'

describe('comfyuiSkills', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns an empty list when no workflow templates exist', () => {
    expect(comfyuiWorkflowSkills()).toEqual([])
  })

  it('maps each workflow template to a comfyui-workflow skill', () => {
    saveWorkflowTemplate({ id: 'w1', name: 'Qwen 改图', graphJson: '{}' })
    saveWorkflowTemplate({ id: 'w2', name: 'SDXL 文生图', graphJson: '{}' })
    const skills = comfyuiWorkflowSkills()
    expect(skills).toHaveLength(2)
    expect(skills[0]).toMatchObject({
      id: 'comfyui-w1',
      name: 'Qwen 改图',
      kind: 'comfyui-workflow',
      enabled: true,
      workflowId: 'w1',
    })
    expect(skills[0].description).toBeTruthy()
  })

  it('derives the task purpose from the workflow name', () => {
    expect(workflowPurpose('Qwen 改图')).toBe('可用于改图任务')
    expect(workflowPurpose('SDXL 文生图')).toBe('可用于文生图任务')
    expect(workflowPurpose('局部重绘 图生图')).toBe('可用于图生图任务')
    expect(workflowPurpose('通用模板')).toBe('可用于图像生成任务')
  })

  it('workflowSkillDescription names the workflow and its purpose', () => {
    saveWorkflowTemplate({ id: 'w', name: 'Qwen 改图', graphJson: '{}' })
    const [skill] = comfyuiWorkflowSkills()
    expect(workflowSkillDescription(skill)).toBe('ComfyUI 工作流「Qwen 改图」可用于改图任务')
  })
})
