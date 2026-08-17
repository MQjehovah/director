<script setup lang="ts">
import { ref, watch } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { Button, Progress } from '../../components/ui'
import { usePlayer } from './usePlayer'
import ShotPlayer from './ShotPlayer.vue'
import { displayAssetOf, useShotActions } from '../storyboard/useShotActions'
import type { Shot } from '../../core/models'

const store = useStoryboardStore()

const player = usePlayer(store.shots)
const actions = useShotActions()
const measuredAssets = new Set<string>()
const warmingUrls = new Set<string>()
const nextVideoUrl = ref<string | undefined>(undefined)

/** 读取视频真实时长（浏览器元数据），用于按实际长度排列时间线/总时长/字幕 */
function measureVideoDuration(url: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const d = video.duration
      resolve(Number.isFinite(d) && d > 0 ? d : 0)
    }
    video.onerror = () => resolve(0)
    video.src = url
  })
}

/** 预热后续视频元数据：切镜时新元素能立刻拿到时长并快速起播 */
function warmVideoMetadata(url: string): Promise<void> {
  if (warmingUrls.has(url)) return Promise.resolve()
  warmingUrls.add(url)
  return new Promise<void>((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => resolve()
    video.onerror = () => resolve()
    video.src = url
  }).finally(() => {
    warmingUrls.delete(url)
  })
}

watch(
  () => player.currentIndex.value,
  async () => {
    // 预热当前镜头之后的 1~2 段视频，并把紧邻的下一段 URL 交给播放器预载（双缓冲）
    let nextUrl: string | undefined
    for (let i = 1; i <= 2; i += 1) {
      const next = store.shots[player.currentIndex.value + i]
      if (!next || next.shotType !== 'video') continue
      const asset = displayAssetOf(next)
      if (!asset) continue
      const url = await actions.resolveAssetUrl(asset)
      if (!url) continue
      if (!nextUrl) nextUrl = url
      void warmVideoMetadata(url)
    }
    nextVideoUrl.value = nextUrl
  },
  { immediate: true },
)

watch(
  () => store.shots.map((s) => ({ id: s.id, type: s.shotType, asset: displayAssetOf(s) })),
  async (list) => {
    for (const item of list) {
      if (item.type !== 'video' || !item.asset || measuredAssets.has(item.asset)) continue
      measuredAssets.add(item.asset)
      const url = await actions.resolveAssetUrl(item.asset)
      if (!url) continue
      const duration = await measureVideoDuration(url)
      if (duration > 0) player.setVideoDuration(item.id, duration)
    }
  },
  { immediate: true },
)

function widthPct(shot: Shot): number {
  const denom = player.total.value
  return denom > 0 ? Math.max((player.durationOf(shot) / denom) * 100, 6) : 0
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4" data-test="player-panel">
    <p v-if="store.shots.length === 0" class="text-sm text-ink-muted" data-test="empty">
      暂无镜头，生成镜头与媒体素材后可在此预览成片。
    </p>

    <template v-else>
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-ink">成片预览</h2>
        <div class="flex items-center gap-3">
          <span class="text-xs text-ink-muted" data-test="player-position">
            {{ player.currentIndex.value + 1 }} / {{ store.shots.length }}
          </span>
          <span class="text-xs text-ink-muted">总时长 {{ player.total.value }}s</span>
        </div>
      </div>

      <div
        class="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-edge bg-zinc-950"
        data-test="player-shot"
      >
        <ShotPlayer
          v-if="player.currentShot.value"
          :shot="player.currentShot.value"
          :playing="player.playing.value"
          :next-url="nextVideoUrl"
          @video-duration="player.setVideoDuration"
          @video-time="player.setVideoTime"
          @video-ended="player.videoEnded"
          @video-play="player.videoPlay"
          @video-pause="player.videoPause"
        />
      </div>

      <div class="flex items-center justify-center gap-2">
        <Button
          size="sm"
          data-test="player-prev"
          :disabled="player.currentIndex.value === 0"
          @click="player.prev()"
        >
          上一条
        </Button>
        <Button
          v-if="!player.playing.value"
          variant="primary"
          size="sm"
          data-test="player-play"
          @click="player.play()"
        >
          播放
        </Button>
        <Button
          v-else
          variant="primary"
          size="sm"
          data-test="player-pause"
          @click="player.pause()"
        >
          暂停
        </Button>
        <Button
          size="sm"
          data-test="player-next"
          :disabled="player.currentIndex.value >= store.shots.length - 1"
          @click="player.next()"
        >
          下一条
        </Button>
        <Button size="sm" data-test="player-reset" @click="player.reset()">重置</Button>
      </div>

      <Progress :value="player.progress.value * 100" data-test="player-progress" />

      <div class="flex w-full items-stretch gap-1 overflow-x-auto" data-test="player-timeline">
        <button
          v-for="(shot, index) in store.shots"
          :key="shot.id"
          type="button"
          data-test="player-timeline-shot"
          class="flex min-w-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-raised py-1 text-xs transition-colors hover:border-zinc-600"
          :class="
            index === player.currentIndex.value
              ? 'border-amber-400/60 text-ink'
              : 'text-ink-muted'
          "
          :style="{ flex: `1 1 ${widthPct(shot)}%`, minWidth: '48px' }"
          @click="player.seek(index)"
        >
          {{ index + 1 }}
        </button>
      </div>
    </template>
  </div>
</template>
