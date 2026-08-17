<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { displayAssetOf, useShotActions } from '../storyboard/useShotActions'
import { shotDuration } from './subtitles'
import type { Shot } from '../../core/models'

const props = withDefaults(
  defineProps<{
    shot: Shot
    subtitle?: string
    playing?: boolean
  }>(),
  {
    subtitle: '',
    playing: false,
  },
)

const emit = defineEmits<{
  (e: 'video-duration', shotId: string, duration: number): void
  (e: 'video-time', shotId: string, time: number): void
  (e: 'video-ended', shotId: string): void
  (e: 'video-play', shotId: string): void
  (e: 'video-pause', shotId: string): void
}>()

const actions = useShotActions()

// 展示生成结果：生成总是把新资产追加到 mediaAssets 末尾，取最后一项，
// 这样 image2video（输入图 + 输出视频）展示的是视频而不是输入图。
const assetId = computed(() => displayAssetOf(props.shot))
// 共享缓存是响应式的：其他面板先解析完成时这里也会自动更新，避免一次性 Promise 的竞态。
const resolvedUrl = computed(() => actions.thumbUrl(assetId.value))

watch(
  assetId,
  (id) => {
    if (!id) return
    void actions.resolveAssetUrl(id)
  },
  { immediate: true },
)

type CameraMove = NonNullable<Shot['camera']>['move']

const MOVE_TRANSFORMS: Record<CameraMove, { from: string; to: string }> = {
  static: { from: 'scale(1.05)', to: 'scale(1.2)' },
  'zoom-in': { from: 'scale(1.05)', to: 'scale(1.35)' },
  'zoom-out': { from: 'scale(1.1)', to: 'scale(1.05)' },
  pan: { from: 'translateX(0) scale(1.15)', to: 'translateX(-5%) scale(1.25)' },
  tilt: { from: 'translateY(0) scale(1.15)', to: 'translateY(-5%) scale(1.25)' },
  tracking: { from: 'translateX(0) scale(1.15)', to: 'translateX(5%) scale(1.25)' },
}

const duration = computed(() => shotDuration(props.shot))

const displayAsImage = computed(() => {
  const url = resolvedUrl.value
  if (!url) return true
  return props.shot.shotType === 'image' || url.startsWith('data:image')
})

const kenBurns = computed(
  () => MOVE_TRANSFORMS[props.shot.camera?.move ?? 'static'] ?? MOVE_TRANSFORMS.static,
)

const kenBurnsStyle = computed(() => ({
  '--kb-from': kenBurns.value.from,
  '--kb-to': kenBurns.value.to,
  animationDuration: `${duration.value}s`,
  animationPlayState: props.playing ? 'running' : 'paused',
}))

const videoRef = ref<HTMLVideoElement | null>(null)

// 用指令式 play/pause 与成片播放状态同步：autoplay 属性在运行中切换并不可靠，
// 且只靠它无法在暂停时真正暂停视频。
watch(
  () => [props.playing, props.shot.id, resolvedUrl.value] as const,
  () => {
    const video = videoRef.value
    if (!video) return
    try {
      if (props.playing) {
        const result = video.play()
        if (result && typeof result.catch === 'function') result.catch(() => {})
      } else {
        video.pause()
      }
    } catch {
      // 测试环境（jsdom）不支持媒体播放时静默
    }
  },
  { immediate: true, flush: 'post' },
)

function reportDuration(): void {
  const video = videoRef.value
  if (!video) return
  const d = video.duration
  if (Number.isFinite(d) && d > 0) emit('video-duration', props.shot.id, d)
}

function onTimeUpdate(): void {
  const video = videoRef.value
  if (!video) return
  emit('video-time', props.shot.id, video.currentTime)
}
</script>

<template>
  <div class="relative aspect-video w-full overflow-hidden bg-zinc-950" data-test="shot-player">
    <template v-if="displayAsImage">
      <img
        v-if="resolvedUrl"
        :key="shot.id"
        :src="resolvedUrl"
        :style="kenBurnsStyle"
        class="ken-burns h-full w-full object-cover"
        alt=""
        data-test="shot-image"
      />
      <span
        v-else
        data-test="shot-placeholder"
        class="flex h-full w-full items-center justify-center text-xs text-ink-muted"
      >
        待生成
      </span>
    </template>
    <video
      v-else
      ref="videoRef"
      :key="shot.id"
      :src="resolvedUrl"
      controls
      muted
      playsinline
      class="h-full w-full object-contain"
      data-test="shot-video"
      @loadedmetadata="reportDuration"
      @durationchange="reportDuration"
      @timeupdate="onTimeUpdate"
      @ended="emit('video-ended', shot.id)"
      @play="emit('video-play', shot.id)"
      @pause="emit('video-pause', shot.id)"
    />
    <span
      v-if="subtitle"
      class="absolute inset-x-0 bottom-0 bg-zinc-950/70 px-3 py-2 text-center text-sm text-zinc-50"
      data-test="subtitle"
    >
      {{ subtitle }}
    </span>
  </div>
</template>

<style scoped>
.ken-burns {
  animation-name: ken-burns;
  animation-timing-function: ease-in-out;
  animation-iteration-count: 1;
  animation-fill-mode: forwards;
}

@keyframes ken-burns {
  from {
    transform: var(--kb-from);
  }
  to {
    transform: var(--kb-to);
  }
}
</style>
