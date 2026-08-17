import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  listSkills,
  saveSkill,
  deleteSkill,
  getSkill,
  toggleSkill,
  resetSkillsForTest,
  getProjectToolSkills,
} from '../skillStore'

describe('skillStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('seeds built-in skills on first load', () => {
    const skills = listSkills()
    const ids = skills.map((s) => s.id)
    expect(ids).toContain('role-card')
    expect(ids).toContain('storyboard-prompt')
    expect(ids).toContain('image-prompt')
    expect(ids).toContain('edit-prompt')
    expect(ids).toContain('director-voice')

    const roleCard = skills.find((s) => s.id === 'role-card')
    expect(roleCard?.kind).toBe('prompt-template')
    expect(roleCard?.builtIn).toBe(true)
    expect(roleCard?.enabled).toBe(true)
    expect(roleCard?.template).toContain('{{appearance}}')
    expect(roleCard?.template).toContain('{{personality}}')
    expect(roleCard?.template).toContain('{{background}}')

    const director = skills.find((s) => s.id === 'director-voice')
    expect(director?.kind).toBe('skill-md')
    expect(director?.builtIn).toBe(true)
    expect(director?.markdown).toBeTruthy()
    expect(director?.description).toBeTruthy()
  })

  it('does not re-seed built-ins when the storage key already exists', () => {
    listSkills()
    saveSkill({
      id: 'custom',
      name: '自定义',
      description: 'x',
      kind: 'prompt-template',
      enabled: true,
      template: '{{a}}',
    })
    const skills = listSkills()
    expect(skills.some((s) => s.id === 'custom')).toBe(true)
    expect(skills).toHaveLength(6)
  })

  it('upserts by id', () => {
    saveSkill({
      id: 'custom',
      name: '一版',
      description: 'a',
      kind: 'prompt-template',
      enabled: true,
    })
    saveSkill({
      id: 'custom',
      name: '二版',
      description: 'b',
      kind: 'prompt-template',
      enabled: true,
    })
    expect(listSkills().filter((s) => s.id === 'custom')).toHaveLength(1)
    expect(getSkill('custom')?.name).toBe('二版')
  })

  it('lists, toggles, gets and deletes a custom skill', () => {
    saveSkill({ id: 'x', name: 'X', description: 'd', kind: 'skill-md', enabled: true, markdown: '# X' })
    expect(getSkill('x')?.name).toBe('X')

    toggleSkill('x')
    expect(getSkill('x')?.enabled).toBe(false)
    toggleSkill('x')
    expect(getSkill('x')?.enabled).toBe(true)

    deleteSkill('x')
    expect(getSkill('x')).toBeUndefined()
  })

  it('persists custom skills across listSkills calls', () => {
    saveSkill({
      id: 'p',
      name: 'P',
      description: 'd',
      kind: 'prompt-template',
      enabled: true,
      template: '{{a}}',
    })
    expect(listSkills().some((s) => s.id === 'p')).toBe(true)
    expect(listSkills().some((s) => s.id === 'p')).toBe(true)
  })

  it('refuses to delete built-in skills', () => {
    deleteSkill('role-card')
    expect(getSkill('role-card')).toBeDefined()
  })

  it('toggleSkill is a no-op for unknown ids', () => {
    expect(() => toggleSkill('missing')).not.toThrow()
  })

  it('resetSkillsForTest restores built-ins and drops custom entries', () => {
    saveSkill({ id: 'custom', name: 'C', description: 'd', kind: 'skill-md', enabled: true })
    resetSkillsForTest()
    const skills = listSkills()
    expect(skills.some((s) => s.id === 'custom')).toBe(false)
    expect(skills).toHaveLength(5)
    expect(skills.every((s) => s.builtIn)).toBe(true)
  })

  it('tolerates unavailable localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(listSkills()).toEqual([])
    expect(() =>
      saveSkill({ id: 'x', name: 'X', description: 'd', kind: 'skill-md', enabled: true }),
    ).not.toThrow()
    expect(getSkill('x')).toBeUndefined()
  })

  it('getProjectToolSkills derives non-persisted project-tool skills', () => {
    const derived = getProjectToolSkills([
      { name: 'generate_script', description: '根据创意生成剧本' },
      { name: 'cut_scene', description: '把场景切分为分镜' },
    ])
    expect(derived).toHaveLength(2)
    expect(derived[0]).toMatchObject({
      id: 'tool-generate_script',
      name: 'generate_script',
      kind: 'project-tool',
      enabled: true,
      toolName: 'generate_script',
      description: '根据创意生成剧本',
    })
    expect(derived[1].toolName).toBe('cut_scene')
    expect(listSkills().some((s) => s.id === 'tool-generate_script')).toBe(false)
  })
})
