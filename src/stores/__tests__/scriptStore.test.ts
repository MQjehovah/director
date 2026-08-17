import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useScriptStore } from '../scriptStore'

describe('script store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('adds scenes and beats, then updates and removes them', () => {
    const s = useScriptStore()
    const scene = s.addScene({ title: '第一场' })
    const beat = s.addBeat(scene.id, { type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    expect(s.scenes).toHaveLength(1)
    expect(s.scenes[0].beats).toHaveLength(1)
    expect(beat.id).toBeTruthy()
    s.updateBeat(scene.id, beat.id, { action: '小明招手' })
    expect(s.scenes[0].beats[0].action).toBe('小明招手')
    s.updateScene(scene.id, { title: '第二场' })
    expect(s.scenes[0].title).toBe('第二场')
    s.removeBeat(scene.id, beat.id)
    expect(s.scenes[0].beats).toHaveLength(0)
    s.removeScene(scene.id)
    expect(s.scenes).toHaveLength(0)
  })
  it('addScene creates an empty script when none exists', () => {
    const s = useScriptStore()
    const scene = s.addScene({ title: '屋顶' })
    expect(s.script).not.toBeNull()
    expect(s.script?.scenes[0].id).toBe(scene.id)
  })
  it('imports markdown into scenes and beats', () => {
    const s = useScriptStore()
    const md = [
      '# 第一场：屋顶',
      '',
      '小明：你终于来了',
      '（动作：小红跑上屋顶）',
      '动作：小红喘着气',
      '音效：远处雷声',
      '[SFX] 门被推开',
      '旁白：这是一个安静的夜晚',
    ].join('\n')
    const script = s.importMarkdown(md)
    expect(s.script?.scenes).toEqual(script.scenes)
    expect(script.scenes).toHaveLength(1)
    expect(script.scenes[0].id).toBe('scene-1')
    expect(script.scenes[0].title).toBe('第一场：屋顶')
    const beats = script.scenes[0].beats
    expect(beats.map((b) => b.type)).toEqual(['dialogue', 'action', 'action', 'sfx', 'sfx', 'dialogue'])
    expect(beats[0].id).toBe('beat-1-1')
    expect(beats[0].dialogue?.speaker).toBe('小明')
    expect(beats[0].dialogue?.text).toBe('你终于来了')
    expect(beats[1].action).toBe('小红跑上屋顶')
    expect(beats[2].action).toBe('小红喘着气')
  })
  it('imports multiple scenes from headings', () => {
    const s = useScriptStore()
    const script = s.importMarkdown('# 场景一\n\n# 场景二\n')
    expect(script.scenes).toHaveLength(2)
    expect(script.scenes[0].id).toBe('scene-1')
    expect(script.scenes[1].id).toBe('scene-2')
  })
})
