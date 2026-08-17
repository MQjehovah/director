import { workflowSkillDescription } from './comfyuiSkills'
import { skillDescription } from './skillMd'
import type { AgentSkill } from './skillStore'

export function buildSkillsContext(skills: AgentSkill[]): string {
  const lines = skills
    .filter((s) => s.enabled)
    .map((s) => (s.kind === 'comfyui-workflow' ? workflowSkillDescription(s) : skillDescription(s)))
  return lines.join('\n')
}
