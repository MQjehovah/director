import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BeatSchema, SceneSchema, ScriptSchema } from '../core/models'
import type { Beat, Scene, Script } from '../core/models'
import { newId } from '../core/utils/id'

export type SceneInput = Omit<Partial<Scene>, 'id'>
export type BeatInput = Omit<Partial<Beat>, 'id' | 'type'> & { type: Beat['type'] }

export const useScriptStore = defineStore('script', () => {
  const script = ref<Script | null>(null)

  const scenes = computed<Scene[]>(() => script.value?.scenes ?? [])

  function setScript(next: Script): void {
    script.value = ScriptSchema.parse(next)
  }

  /** 清空当前剧本（用于切换项目/新建项目） */
  function clearScript(): void {
    script.value = null
  }

  function addScene(data: SceneInput = {}): Scene {
    if (!script.value) {
      script.value = ScriptSchema.parse({ id: newId('script'), title: '未命名剧本' })
    }
    const scene = SceneSchema.parse({ id: newId('scene'), ...data })
    script.value = ScriptSchema.parse({ ...script.value, scenes: [...script.value.scenes, scene] })
    return scene
  }

  function updateScene(id: string, patch: Partial<Omit<Scene, 'id'>>): void {
    if (!script.value) return
    setScript({
      ...script.value,
      scenes: script.value.scenes.map((s) =>
        s.id === id ? SceneSchema.parse({ ...s, ...patch, id }) : s,
      ),
    })
  }

  function removeScene(id: string): void {
    if (!script.value) return
    setScript({ ...script.value, scenes: script.value.scenes.filter((s) => s.id !== id) })
  }

  function addBeat(sceneId: string, data: BeatInput): Beat {
    if (!script.value) throw new Error('no script set')
    const scene = script.value.scenes.find((s) => s.id === sceneId)
    if (!scene) throw new Error(`scene not found: ${sceneId}`)
    const beat = BeatSchema.parse({ id: newId('beat'), ...data })
    setScript({
      ...script.value,
      scenes: script.value.scenes.map((s) =>
        s.id === sceneId ? { ...s, beats: [...s.beats, beat] } : s,
      ),
    })
    return beat
  }

  function updateBeat(sceneId: string, beatId: string, patch: Partial<Omit<Beat, 'id'>>): void {
    if (!script.value) return
    setScript({
      ...script.value,
      scenes: script.value.scenes.map((s) =>
        s.id !== sceneId
          ? s
          : SceneSchema.parse({
              ...s,
              beats: s.beats.map((b) =>
                b.id === beatId ? BeatSchema.parse({ ...b, ...patch, id: beatId }) : b,
              ),
            }),
      ),
    })
  }

  function removeBeat(sceneId: string, beatId: string): void {
    if (!script.value) return
    setScript({
      ...script.value,
      scenes: script.value.scenes.map((s) =>
        s.id === sceneId ? { ...s, beats: s.beats.filter((b) => b.id !== beatId) } : s,
      ),
    })
  }

  function importMarkdown(md: string): Script {
    let sceneSeq = 0
    const parsedScenes: Scene[] = []
    let current: Scene | null = null

    function beginScene(title: string): void {
      sceneSeq += 1
      current = SceneSchema.parse({ id: `scene-${sceneSeq}`, title, beats: [] })
      parsedScenes.push(current)
    }

    function pushBeat(type: Beat['type'], extra: Omit<Partial<Beat>, 'id' | 'type'>): void {
      if (!current) beginScene('未命名场次')
      const beat = BeatSchema.parse({ id: `beat-${sceneSeq}-${current!.beats.length + 1}`, type, ...extra })
      current!.beats.push(beat)
    }

    for (const rawLine of md.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith('#')) {
        const title = line.replace(/^#+\s*/, '').trim()
        if (title) beginScene(title)
        continue
      }
      if (line.startsWith('动作') && line.length > 2 && (line[2] === '：' || line[2] === ':')) {
        pushBeat('action', { action: line.replace(/^动作[：:]\s*/, '') })
        continue
      }
      if (line.startsWith('（动作') || line.startsWith('(动作')) {
        pushBeat('action', {
          action: line.replace(/^[（(]动作[：:]?\s*/, '').replace(/[）)]\s*$/, ''),
        })
        continue
      }
      if (line.startsWith('音效') && line.length > 2 && (line[2] === '：' || line[2] === ':')) {
        pushBeat('sfx', { action: line.replace(/^音效[：:]\s*/, '') })
        continue
      }
      if (/^\[sfx\]/i.test(line)) {
        pushBeat('sfx', { action: line.replace(/^\[sfx\]\s*/i, '') })
        continue
      }
      const dialogue = line.match(/^(.+?)[：:]\s*(.+)$/)
      if (dialogue) {
        pushBeat('dialogue', { dialogue: { speaker: dialogue[1], text: dialogue[2] } })
        continue
      }
      pushBeat('action', { action: line })
    }

    const parsed = ScriptSchema.parse({
      id: newId('script'),
      title: parsedScenes[0]?.title ?? '未命名剧本',
      scenes: parsedScenes,
    })
    script.value = parsed
    return parsed
  }

  return {
    script,
    scenes,
    setScript,
    clearScript,
    addScene,
    updateScene,
    removeScene,
    addBeat,
    updateBeat,
    removeBeat,
    importMarkdown,
  }
})
