import { describe, it, expect } from 'vitest'
import {
  CharacterSchema,
  SceneSchema,
  ShotSchema,
  JobSchema,
  BeatSchema,
  AssetSchema,
} from '../index'

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
  it('accepts an action beat with its action text', () => {
    const b = BeatSchema.parse({ id: 'b1', type: 'action', action: '小明推门而入' })
    expect(b.action).toBe('小明推门而入')
    expect(b.dialogue).toBeUndefined()
  })
  it('accepts a scene with scene image and reference images', () => {
    const s = SceneSchema.parse({
      id: 'sc1',
      title: '屋顶',
      artMode: 'img2img',
      sceneImage: 'asset-1',
      referenceImages: ['asset-ref'],
    })
    expect(s.artMode).toBe('img2img')
    expect(s.sceneImage).toBe('asset-1')
    expect(s.referenceImages).toEqual(['asset-ref'])
    expect(s.metadata).toEqual({})
  })
  it('requires asset to have url or localPath', () => {
    expect(() => AssetSchema.parse({ id: 'a1', kind: 'image', source: 'ai' })).toThrow()
    expect(() => AssetSchema.parse({ id: 'a1', kind: 'image', source: 'ai', url: 'x' })).not.toThrow()
    expect(() => AssetSchema.parse({ id: 'a1', kind: 'image', source: 'ai', localPath: 'y' })).not.toThrow()
  })
  it('allows shot creation without camera config', () => {
    const s = ShotSchema.parse({ id: 's1', shotType: 'image' })
    expect(s.camera).toBeUndefined()
    expect(s.beatRef).toBeUndefined()
  })
  it('accepts shot with shotRef linking a job', () => {
    const j = JobSchema.parse({ id: 'j1', type: 'image2video', shotRef: 's1' })
    expect(j.shotRef).toBe('s1')
  })
})
