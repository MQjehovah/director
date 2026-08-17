import { describe, it, expect } from 'vitest'
import { CharacterSchema, ShotSchema, JobSchema } from '../index'

describe('domain models', () => {
  it('validates a character', () => {
    const c = CharacterSchema.parse({ id: 'c1', name: '小明', appearance: '黑发少年' })
    expect(c.name).toBe('小明')
    expect(c.referenceImages).toEqual([])
  })
  it('rejects invalid shotType', () => {
    expect(() => ShotSchema.parse({ id: 's1', beatRef: 'b1', shotType: 'gif' })).toThrow()
  })
  it('enforces job status enum', () => {
    const j = JobSchema.parse({ id: 'j1', type: 'text2image', status: 'queued' })
    expect(j.status).toBe('queued')
    expect(() => JobSchema.parse({ id: 'j2', type: 'x', status: 'bogus' })).toThrow()
  })
})
