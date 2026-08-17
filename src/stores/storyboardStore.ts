import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ShotSchema } from '../core/models'
import type { Scene, Shot } from '../core/models'

export type ShotInput = Omit<Partial<Shot>, 'id'> & { shotType: Shot['shotType'] }

export const useStoryboardStore = defineStore('storyboard', () => {
  const shots = ref<Shot[]>([])
  let seq = 0

  function nextShotId(): string {
    seq += 1
    return `shot-${seq}`
  }

  function addShot(data: ShotInput): Shot {
    const shot = ShotSchema.parse({ id: nextShotId(), ...data })
    shots.value.push(shot)
    return shot
  }

  function updateShot(id: string, patch: Partial<Omit<Shot, 'id'>>): void {
    shots.value = shots.value.map((s) =>
      s.id === id ? ShotSchema.parse({ ...s, ...patch, id }) : s,
    )
  }

  function removeShot(id: string): void {
    shots.value = shots.value.filter((s) => s.id !== id)
  }

  function moveShot(fromIndex: number, toIndex: number): void {
    const count = shots.value.length
    if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) return
    const next = [...shots.value]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    shots.value = next
  }

  function reorder(ids: string[]): void {
    const order = new Map(ids.map((id, i) => [id, i]))
    shots.value = [...shots.value].sort((a, b) => {
      const ai = order.get(a.id)
      const bi = order.get(b.id)
      if (ai === undefined && bi === undefined) return 0
      if (ai === undefined) return 1
      if (bi === undefined) return -1
      return ai - bi
    })
  }

  function cutSceneToShots(scene: Scene): Shot[] {
    const beatIds = new Set(scene.beats.map((b) => b.id))
    shots.value = shots.value.filter((s) => !(s.beatRef && beatIds.has(s.beatRef)))
    const created: Shot[] = []
    for (const beat of scene.beats) {
      const shot = ShotSchema.parse({
        id: nextShotId(),
        beatRef: beat.id,
        shotType: 'image',
        prompt: beat.action ?? beat.dialogue?.text,
      })
      created.push(shot)
      shots.value.push(shot)
    }
    return created
  }

  function getShotsByBeat(beatId: string): Shot[] {
    return shots.value.filter((s) => s.beatRef === beatId)
  }

  function shotById(id: string): Shot | undefined {
    return shots.value.find((s) => s.id === id)
  }

  return {
    shots,
    addShot,
    updateShot,
    removeShot,
    moveShot,
    reorder,
    cutSceneToShots,
    getShotsByBeat,
    shotById,
  }
})
