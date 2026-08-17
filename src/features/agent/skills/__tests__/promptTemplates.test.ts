import { describe, it, expect } from 'vitest'
import { fillTemplate, templatePlaceholders, builtinPromptTemplates } from '../promptTemplates'

describe('fillTemplate', () => {
  it('replaces placeholders with provided values', () => {
    const out = fillTemplate('角色：{{name}}，性格：{{personality}}', {
      name: '小明',
      personality: '乐观',
    })
    expect(out).toBe('角色：小明，性格：乐观')
  })

  it('leaves unknown placeholders literal', () => {
    const out = fillTemplate('{{known}} / {{unknown}}', { known: '值' })
    expect(out).toBe('值 / {{unknown}}')
  })

  it('replaces every occurrence of a placeholder', () => {
    expect(fillTemplate('{{tag}}-{{tag}}-{{tag}}', { tag: 'x' })).toBe('x-x-x')
  })
})

describe('templatePlaceholders', () => {
  it('collects unique placeholder names in order of first appearance', () => {
    expect(templatePlaceholders('{{a}} then {{b}} then {{a}}')).toEqual(['a', 'b'])
  })

  it('returns an empty array when the template has no placeholders', () => {
    expect(templatePlaceholders('no placeholders here')).toEqual([])
  })
})

describe('builtinPromptTemplates', () => {
  it('returns the four built-in prompt-template skills', () => {
    const skills = builtinPromptTemplates()
    expect(skills.map((s) => s.id)).toEqual([
      'role-card',
      'storyboard-prompt',
      'image-prompt',
      'edit-prompt',
    ])
    for (const skill of skills) {
      expect(skill.kind).toBe('prompt-template')
      expect(skill.builtIn).toBe(true)
      expect(skill.enabled).toBe(true)
      expect(skill.template).toBeTruthy()
      expect(skill.description).toBeTruthy()
    }
  })

  it('uses distinct placeholder sets per built-in template', () => {
    const skills = builtinPromptTemplates()
    const idToPlaceholders = Object.fromEntries(
      skills.map((s) => [s.id, templatePlaceholders(s.template as string)]),
    )
    expect(idToPlaceholders['role-card']).toEqual(['appearance', 'personality', 'background'])
    expect(idToPlaceholders['storyboard-prompt']).toEqual(['scene', 'shotType'])
    expect(idToPlaceholders['image-prompt']).toEqual(['subject', 'style'])
    expect(idToPlaceholders['edit-prompt']).toEqual(['instruction'])
  })
})
