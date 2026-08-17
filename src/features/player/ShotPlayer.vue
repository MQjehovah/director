<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { displayAssetOf, useShotActions } from '../storyboard/useShotActions'
import { shotDuration } from './subtitles'
import type { Shot } from '../../core/models'

const props = withDefaults(
  defineProps<{
    shot: Shot
    playing?: boolean
  }>(),
  {
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
let resumeTimer: ReturnType<typeof setInterval> | undefined
let hasStarted = false

// 视频元素按资产重建：切镜/重生成后重置“已开始播放”标志，
// 避免上一段的状态泄漏导致新镜头加载期的 pause 被误同步。
watch(
  () => assetId.value,
  () => {
    hasStarted = false
  },
  { immediate: true },
)

// 播放自愈：成片处于播放态时，若视频已加载却被暂停（起播竞态/误停），自动恢复播放
watch(
  () => props.playing,
  (playing) => {
    if (playing && resumeTimer === undefined) {
      resumeTimer = setInterval(() => {
        const video = videoRef.value
        if (!video || !props.playing) return
        if (video.paused && !video.ended && video.readyState >= 2) {
          try {
            const result = video.play()
            if (result && typeof result.catch === 'function') result.catch(() => {})
          } catch {
            // 环境不支持时忽略
          }
        }
      }, 300)
    } else if (!playing && resumeTimer !== undefined) {
      clearInterval(resumeTimer)
      resumeTimer = undefined
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (resumeTimer !== undefined) {
    clearInterval(resumeTimer)
    resumeTimer = undefined
  }
})

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
  if (Number.isFinite(d) && d > 0) {
    emit('video-duration', props.shot.id, d)
    // 切镜/重生成后元素刚挂载、src 未就绪时 play() 会被拒绝；元数据就绪后补一次播放
    if (props.playing) {
      try {
        const result = video.play()
        if (result && typeof result.catch === 'function') result.catch(() => {})
      } catch {
        // 环境不支持时忽略
      }
    }
  }
}

function onTimeUpdate(): void {
  const video = videoRef.value
  if (!video) return
  emit('video-time', props.shot.id, video.currentTime)
}

function onCanPlay(): void {
  // 数据足够开始播放时就起播，不必等整段加载完
  if (!props.playing) return
  try {
    const result = videoRef.value?.play()
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {
    // 环境不支持时忽略
  }
}

function onPlay(): void {
  hasStarted = true
  emit('video-play', props.shot.id)
}

function onPause(): void {
  // 加载/初始化阶段浏览器可能误发 pause 事件：只有真正开始播放过后才同步成片状态，
  // 避免第三段刚加载就被误判为“用户暂停”而把连播停掉。
  if (!hasStarted) return
  const video = videoRef.value
  // 自然播到结尾时浏览器会在 ended 前后触发 pause：不算用户暂停，不能拉停成片
  if (video) {
    if (video.ended) return
    if (video.duration > 0 && video.currentTime >= video.duration - 0.15) return
  }
  emit('video-pause', props.shot.id)
}
</script>

<template>
  <div
    class="relative aspect-video max-h-full w-full overflow-hidden bg-zinc-950"
    data-test="shot-player"
  >
    <template v-if="displayAsImage">
      <img
        v-if="resolvedUrl"
        :key="assetId"
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
      :key="assetId"
      :src="resolvedUrl"
      controls
      muted
      playsinline
      preload="auto"
      class="h-full w-full object-contain"
      data-test="shot-video"
      @loadedmetadata="reportDuration"
      @durationchange="reportDuration"
      @timeupdate="onTimeUpdate"
      @canplay="onCanPlay"
      @loadeddata="onCanPlay"
      @ended="emit('video-ended', shot.id)"
      @play="onPlay"
      @pause="onPause"
    />
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
