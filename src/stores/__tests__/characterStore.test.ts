import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCharacterStore } from '../characterStore'

describe('character store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('adds, updates, removes characters', () => {
    const s = useCharacterStore()
    const c = s.addCharacter({ name: '小明', appearance: '黑发少年', tags: ['主角'] })
    expect(c.id).toBeTruthy()
    expect(s.characters).toHaveLength(1)
    s.updateCharacter(c.id, { appearance: '金发少年' })
    expect(s.getCharacter(c.id)?.appearance).toBe('金发少年')
    s.removeCharacter(c.id)
    expect(s.characters).toHaveLength(0)
    expect(s.getCharacter(c.id)).toBeUndefined()
  })
  it('finds characters by tag', () => {
    const s = useCharacterStore()
    s.addCharacter({ name: '小明', tags: ['主角'] })
    s.addCharacter({ name: '小红', tags: ['配角'] })
    expect(s.findByTag('主角')).toHaveLength(1)
    expect(s.findByTag('主角')[0].name).toBe('小明')
  })
  it('applies schema defaults on add', () => {
    const s = useCharacterStore()
    const c = s.addCharacter({ name: '路人' })
    expect(c.referenceImages).toEqual([])
    expect(c.tags).toEqual([])
    expect(c.metadata).toEqual({})
  })
})
