import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStoryboardStore } from '../storyboardStore'
import type { Scene } from '../../core/models'

function makeScene(): Scene {
  return {
    id: 'scene-1',
    title: '屋顶',
    beats: [
      { id: 'beat-1', type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } },
      { id: 'beat-2', type: 'action', action: '小红挥手' },
    ],
    referenceImages: [],
    metadata: {},
  }
}

describe('storyboard store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('adds, updates, removes and reorders shots', () => {
    const s = useStoryboardStore()
    const a = s.addShot({ shotType: 'image', prompt: 'a' })
    const b = s.addShot({ shotType: 'image', prompt: 'b' })
    const c = s.addShot({ shotType: 'image', prompt: 'c' })
    s.moveShot(0, 2)
    expect(s.shots.map((x) => x.id)).toEqual([b.id, c.id, a.id])
    s.reorder([a.id, b.id, c.id])
    expect(s.shots.map((x) => x.id)).toEqual([a.id, b.id, c.id])
    s.updateShot(a.id, { prompt: 'A' })
    expect(s.shotById(a.id)?.prompt).toBe('A')
    s.removeShot(c.id)
    expect(s.shots).toHaveLength(2)
    expect(s.shotById(c.id)).toBeUndefined()
  })
  it('cuts a scene into one video shot per beat', () => {
    const s = useStoryboardStore()
    const shots = s.cutSceneToShots(makeScene())
    expect(shots).toHaveLength(2)
    expect(shots[0].shotType).toBe('video')
    expect(shots[0].beatRef).toBe('beat-1')
    expect(shots[0].id).toBe('shot-1')
    expect(shots[1].id).toBe('shot-2')
    expect(s.shots).toHaveLength(2)
    expect(s.getShotsByBeat('beat-1')).toHaveLength(1)
  })
})
