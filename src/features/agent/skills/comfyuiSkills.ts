import { listWorkflowTemplates } from '../../comfyui/workflowStore'
import type { AgentSkill } from './skillStore'

export function workflowPurpose(name: string): string {
  if (name.includes('改图')) return '可用于改图任务'
  if (name.includes('图生图')) return '可用于图生图任务'
  if (name.includes('文生图')) return '可用于文生图任务'
  return '可用于图像生成任务'
}

export function comfyuiWorkflowSkills(): AgentSkill[] {
  return listWorkflowTemplates().map((tpl) => ({
    id: `comfyui-${tpl.id}`,
    name: tpl.name,
    description: workflowPurpose(tpl.name),
    kind: 'comfyui-workflow',
    enabled: true,
    workflowId: tpl.id,
  }))
}

export function workflowSkillDescription(skill: AgentSkill): string {
  return `ComfyUI 工作流「${skill.name}」${skill.description}`
}
