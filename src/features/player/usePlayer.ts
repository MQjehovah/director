import { computed, getCurrentScope, onScopeDispose, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { Shot } from '../../core/models'
import { buildSubtitleTrack, shotDuration, totalDuration } from './subtitles'
import type { DialogueResolver, SubtitleEntry } from './subtitles'

export const PLAYER_TICK_MS = 100

export interface UsePlayerOptions {
  getDialogue?: DialogueResolver
  tickMs?: number
}

export function usePlayer(shotsInput: MaybeRefOrGetter<Shot[]>, options: UsePlayerOptions = {}) {
  const tickMs = options.tickMs ?? PLAYER_TICK_MS
  const shots = computed<Shot[]>(() => toValue(shotsInput))
  const track = computed<SubtitleEntry[]>(() => buildSubtitleTrack(shots.value, options.getDialogue))

  const currentIndex = ref(0)
  const playing = ref(false)
  const currentTime = ref(0)

  let timer: ReturnType<typeof setInterval> | undefined
  let lastTickAt = 0

  const currentShot = computed<Shot | undefined>(() => shots.value[currentIndex.value])
  const currentSubtitle = computed<SubtitleEntry | undefined>(() => track.value[currentIndex.value])

  const progress = computed(() => {
    const total = totalDuration(track.value)
    if (total <= 0) return 0
    let elapsed = 0
    for (let i = 0; i < currentIndex.value; i += 1) elapsed += shotDuration(shots.value[i])
    elapsed += currentTime.value
    return Math.min(elapsed / total, 1)
  })

  const total = computed(() => totalDuration(track.value))

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  function tick(): void {
    if (!playing.value) return
    const shot = currentShot.value
    if (!shot) {
      playing.value = false
      stop()
      return
    }
    const now = Date.now()
    const delta = lastTickAt === 0 ? tickMs / 1000 : (now - lastTickAt) / 1000
    lastTickAt = now
    const duration = shotDuration(shot)
    currentTime.value += delta
    if (currentTime.value < duration) return
    const overflow = currentTime.value - duration
    if (currentIndex.value < shots.value.length - 1) {
      currentIndex.value += 1
      currentTime.value = overflow
    } else {
      currentTime.value = duration
      playing.value = false
      stop()
    }
  }

  function play(): void {
    if (shots.value.length === 0) return
    if (currentIndex.value >= shots.value.length) {
      currentIndex.value = 0
      currentTime.value = 0
    }
    if (
      currentIndex.value === shots.value.length - 1 &&
      currentTime.value >= shotDuration(currentShot.value!)
    ) {
      currentIndex.value = 0
      currentTime.value = 0
    }
    playing.value = true
    lastTickAt = Date.now()
    if (timer === undefined) timer = setInterval(tick, tickMs)
  }

  function pause(): void {
    playing.value = false
    stop()
  }

  function toggle(): void {
    if (playing.value) pause()
    else play()
  }

  function seek(index: number): void {
    if (shots.value.length === 0) return
    currentIndex.value = Math.max(0, Math.min(index, shots.value.length - 1))
    currentTime.value = 0
  }

  function reset(): void {
    pause()
    currentIndex.value = 0
    currentTime.value = 0
  }

  function next(): void {
    if (currentIndex.value < shots.value.length - 1) {
      currentIndex.value += 1
      currentTime.value = 0
    } else {
      pause()
    }
  }

  function prev(): void {
    if (currentIndex.value > 0) {
      currentIndex.value -= 1
      currentTime.value = 0
    }
  }

  watch(
    () => shots.value.length,
    (length) => {
      if (length === 0) {
        currentIndex.value = 0
        currentTime.value = 0
        playing.value = false
        stop()
      } else if (currentIndex.value >= length) {
        currentIndex.value = length - 1
        currentTime.value = 0
      }
    },
  )

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    currentIndex,
    playing,
    currentTime,
    progress,
    currentShot,
    currentSubtitle,
    track,
    total,
    play,
    pause,
    toggle,
    seek,
    reset,
    next,
    prev,
  }
}
