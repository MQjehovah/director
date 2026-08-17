import type { Script, Shot } from '../../core/models'

export interface SubtitleEntry {
  shotId: string
  text: string
  start: number
  end: number
  duration: number
}

export interface AudioEntry {
  shotId: string
  audioAssetId?: string
  start: number
  end: number
  duration: number
}

export type AudioResolver = (shot: Shot) => string | undefined

export function buildAudioTrack(shots: Shot[], resolver?: AudioResolver): AudioEntry[] {
  const resolveId = resolver ?? (() => undefined)
  let start = 0
  return shots.map((shot) => {
    const duration = shotDuration(shot)
    const entry: AudioEntry = {
      shotId: shot.id,
      audioAssetId: resolveId(shot),
      start,
      end: start + duration,
      duration,
    }
    start += duration
    return entry
  })
}

export type DialogueResolver = (shot: Shot) => string | undefined

interface ShotWithFallbacks {
  duration?: number
  dialogue?: string
}

const DEFAULT_DURATION = 4

export function shotDuration(shot: Shot): number {
  return shot.camera?.duration ?? (shot as ShotWithFallbacks).duration ?? DEFAULT_DURATION
}

function defaultResolver(shot: Shot): string | undefined {
  return (shot as ShotWithFallbacks).dialogue
}

export function buildSubtitleTrack(shots: Shot[], resolver?: DialogueResolver): SubtitleEntry[] {
  const resolveText = resolver ?? defaultResolver
  let start = 0
  return shots.map((shot) => {
    const duration = shotDuration(shot)
    const entry: SubtitleEntry = {
      shotId: shot.id,
      text: resolveText(shot) ?? '',
      start,
      end: start + duration,
      duration,
    }
    start += duration
    return entry
  })
}

export function subtitleForTime(track: SubtitleEntry[], time: number): SubtitleEntry | undefined {
  return track.find((entry) => time >= entry.start && time < entry.end)
}

export function totalDuration(track: SubtitleEntry[] | AudioEntry[]): number {
  return track.reduce((sum, entry) => sum + entry.duration, 0)
}

export function beatDialogueForShot(
  script: Script | null | undefined,
  shot: Shot,
): string | undefined {
  if (!script || !shot.beatRef) return undefined
  for (const scene of script.scenes) {
    for (const beat of scene.beats) {
      if (beat.id !== shot.beatRef) continue
      if (beat.dialogue) return `${beat.dialogue.speaker}：${beat.dialogue.text}`
      return undefined
    }
  }
  return undefined
}
