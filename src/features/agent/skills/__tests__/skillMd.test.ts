import { describe, it, expect } from 'vitest'
import { parseSkillMarkdown, skillDescription } from '../skillMd'
import { builtinPromptTemplates } from '../promptTemplates'
import type { AgentSkill } from '../skillStore'

describe('parseSkillMarkdown', () => {
  it('extracts the description from the first non-empty paragraph, skipping headings', () => {
    const markdown = '# 我的技能\n\n用于做某件事。\n\n## 用法\n\n- 步骤一\n- 步骤二'
    const skill = parseSkillMarkdown('my-skill', markdown)
    expect(skill.name).toBe('my-skill')
    expect(skill.kind).toBe('skill-md')
    expect(skill.enabled).toBe(true)
    expect(skill.id).toBeTruthy()
    expect(skill.description).toBe('用于做某件事。')
    expect(skill.markdown).toBe(markdown)
  })

  it('handles leading blank lines', () => {
    const skill = parseSkillMarkdown('x', '\n\n第一行\n更多')
    expect(skill.description).toBe('第一行')
  })

  it('returns an empty description for empty or heading-only markdown', () => {
    expect(parseSkillMarkdown('x', '   \n\n').description).toBe('')
    expect(parseSkillMarkdown('x', '# 只有标题').description).toBe('')
  })
})

describe('skillDescription', () => {
  it('describes prompt-template skills with their placeholders', () => {
    const roleCard = builtinPromptTemplates().find((s) => s.id === 'role-card')
    expect(roleCard).toBeDefined()
    const desc = skillDescription(roleCard as AgentSkill)
    expect(desc).toContain('提示词模板「角色设定卡」')
    expect(desc).toContain('{{appearance}}')
    expect(desc).toContain('{{background}}')
  })

  it('returns the plain description for skill-md skills', () => {
    const skill = parseSkillMarkdown('x', '用于做某件事。\n\n更多内容')
    expect(skillDescription(skill)).toBe('用于做某件事。')
  })

  it('falls back to the description for other kinds', () => {
    const tool: AgentSkill = {
      id: 't',
      name: 'generate_script',
      description: '根据创意生成剧本',
      kind: 'project-tool',
      enabled: true,
    }
    expect(skillDescription(tool)).toBe('根据创意生成剧本')
  })
})
