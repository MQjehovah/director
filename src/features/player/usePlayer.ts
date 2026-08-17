import { computed, getCurrentScope, onScopeDispose, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { Shot } from '../../core/models'
import { buildSubtitleTrack, shotDuration } from './subtitles'
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
  // 视频镜头的真实时长（由 loadedmetadata/durationchange 上报），用于驱动进度与切镜
  const videoDurations = ref<Record<string, number>>({})

  let timer: ReturnType<typeof setInterval> | undefined
  let lastTickAt = 0

  const currentShot = computed<Shot | undefined>(() => shots.value[currentIndex.value])
  const currentSubtitle = computed<SubtitleEntry | undefined>(() => track.value[currentIndex.value])

  /** 镜头实际时长：视频镜头优先用真实时长，其余回退到镜头配置时长 */
  function effectiveDuration(shot: Shot | undefined): number {
    if (!shot) return 0
    return videoDurations.value[shot.id] ?? shotDuration(shot)
  }

  /** 视频镜头在真实时长上报后由视频事件驱动（timeupdate/ended），计时器不再累加 */
  function isVideoDriven(shot: Shot | undefined): boolean {
    return !!shot && shot.shotType === 'video' && videoDurations.value[shot.id] !== undefined
  }

  const total = computed(() => shots.value.reduce((sum, s) => sum + effectiveDuration(s), 0))

  const progress = computed(() => {
    const totalDurationValue = total.value
    if (totalDurationValue <= 0) return 0
    let elapsed = 0
    for (let i = 0; i < currentIndex.value; i += 1) elapsed += effectiveDuration(shots.value[i])
    elapsed += currentTime.value
    return Math.min(elapsed / totalDurationValue, 1)
  })

  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  /** 结束当前镜头：前进到下一镜头（视频镜头从 0 开始）或停在结尾 */
  function advance(overflow: number): void {
    if (currentIndex.value < shots.value.length - 1) {
      currentIndex.value += 1
      const next = currentShot.value
      currentTime.value = next?.shotType === 'video' ? 0 : overflow
    } else {
      currentTime.value = effectiveDuration(currentShot.value)
      playing.value = false
      stop()
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
    if (isVideoDriven(shot)) return
    const duration = effectiveDuration(shot)
    currentTime.value += delta
    if (currentTime.value < duration) return
    advance(currentTime.value - duration)
  }

  function play(): void {
    if (shots.value.length === 0) return
    if (currentIndex.value >= shots.value.length) {
      currentIndex.value = 0
      currentTime.value = 0
    }
    if (
      currentIndex.value === shots.value.length - 1 &&
      currentTime.value >= effectiveDuration(currentShot.value)
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

  /** 视频上报真实时长；仅接受当前镜头上报，避免切镜后旧事件写入 */
  function setVideoDuration(shotId: string, duration: number): void {
    if (shotId !== currentShot.value?.id) return
    if (!Number.isFinite(duration) || duration <= 0) return
    videoDurations.value = { ...videoDurations.value, [shotId]: duration }
  }

  /** 视频 timeupdate：同步镜头内时间；播放中播到结尾则切镜 */
  function setVideoTime(shotId: string, time: number): void {
    const shot = currentShot.value
    if (shotId !== shot?.id || !isVideoDriven(shot)) return
    const duration = effectiveDuration(shot)
    const t = Math.max(0, Math.min(time, duration))
    currentTime.value = t
    if (playing.value && t >= duration - 0.05) advance(0)
  }

  /** 视频 ended：镜头结束 */
  function videoEnded(shotId: string): void {
    if (shotId !== currentShot.value?.id) return
    advance(0)
  }

  /** 视频元素自身的播放/暂停（用户点击原生控件时同步成片播放状态） */
  function syncPlaying(shotId: string, next: boolean): void {
    if (shotId !== currentShot.value?.id) return
    if (next) {
      if (!playing.value) {
        playing.value = true
        lastTickAt = Date.now()
      }
      if (timer === undefined) timer = setInterval(tick, tickMs)
    } else if (playing.value) {
      playing.value = false
      stop()
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
    durationOf: effectiveDuration,
    play,
    pause,
    toggle,
    seek,
    reset,
    next,
    prev,
    setVideoDuration,
    setVideoTime,
    videoEnded,
    videoPlay: (shotId: string) => syncPlaying(shotId, true),
    videoPause: (shotId: string) => syncPlaying(shotId, false),
  }
}
