import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildSkillsContext } from '../skillDescriptions'
import { listSkills, saveSkill } from '../skillStore'
import { comfyuiWorkflowSkills } from '../comfyuiSkills'
import { saveWorkflowTemplate } from '../../../comfyui/workflowStore'

describe('buildSkillsContext', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes only enabled skills', () => {
    saveSkill({
      id: 'a',
      name: 'A',
      description: '技能A描述',
      kind: 'skill-md',
      enabled: true,
      markdown: 'x',
    })
    saveSkill({
      id: 'b',
      name: 'B',
      description: '技能B描述',
      kind: 'skill-md',
      enabled: false,
      markdown: 'y',
    })
    const ctx = buildSkillsContext(listSkills())
    expect(ctx).toContain('技能A描述')
    expect(ctx).not.toContain('技能B描述')
  })

  it('describes prompt-template skills with their placeholders', () => {
    const ctx = buildSkillsContext(listSkills())
    expect(ctx).toContain('提示词模板「角色设定卡」')
    expect(ctx).toContain('{{appearance}}')
    expect(ctx).toContain('提示词模板「分镜描述模板」')
    expect(ctx).toContain('{{shotType}}')
  })

  it('describes skill-md skills via their description', () => {
    const director = listSkills().find((s) => s.id === 'director-voice')
    expect(director).toBeDefined()
    expect(buildSkillsContext([director as typeof director & { enabled: boolean }])).toBe(
      director?.description,
    )
  })

  it('describes comfyui-workflow skills', () => {
    saveWorkflowTemplate({ id: 'w', name: 'Qwen 改图', graphJson: '{}' })
    const ctx = buildSkillsContext(comfyuiWorkflowSkills())
    expect(ctx).toContain('ComfyUI 工作流「Qwen 改图」可用于改图任务')
  })

  it('returns an empty string when no skills are enabled', () => {
    expect(buildSkillsContext([])).toBe('')
  })
})
