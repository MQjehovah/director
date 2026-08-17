import { workflowSkillDescription } from './comfyuiSkills'
import { skillDescription } from './skillMd'
import type { AgentSkill } from './skillStore'

/**
 * 为 agent 系统提示词构建技能上下文。
 * - prompt-template：一行摘要（模板名 + 占位符）
 * - skill-md：输出完整 markdown（描述 + 全文），让技能内容真正到达 LLM
 * - comfyui-workflow：工作流用途说明
 * - project-tool：跳过 —— 工具已在 agent 的工具列表中描述，避免重复
 */
export function buildSkillsContext(skills: AgentSkill[]): string {
  const lines = skills
    .filter((s) => s.enabled)
    .filter((s) => s.kind !== 'project-tool')
    .map((s) => {
      if (s.kind === 'comfyui-workflow') return workflowSkillDescription(s)
      if (s.kind === 'skill-md') return s.markdown || skillDescription(s)
      return skillDescription(s)
    })
  return lines.join('\n\n')
}
