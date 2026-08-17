import { newId } from '../../../core/utils/id'
import { templatePlaceholders } from './promptTemplates'
import type { AgentSkill } from './skillStore'

function firstParagraph(markdown: string): string {
  const line = markdown
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'))
  return line ?? ''
}

export function parseSkillMarkdown(name: string, markdown: string): AgentSkill {
  return {
    id: newId('skill'),
    name,
    description: firstParagraph(markdown),
    kind: 'skill-md',
    enabled: true,
    markdown,
  }
}

export function skillDescription(skill: AgentSkill): string {
  if (skill.kind === 'prompt-template' && skill.template) {
    const placeholders = templatePlaceholders(skill.template)
    const placeholderText =
      placeholders.length > 0
        ? `可用 ${placeholders.map((p) => `{{${p}}}`).join('、')} 等占位符`
        : ''
    const description = skill.description ? `，${skill.description}` : ''
    return `提示词模板「${skill.name}」：${placeholderText}${description}`
  }
  return skill.description
}
