<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { displayAssetOf, useShotActions } from '../storyboard/useShotActions'
import { shotDuration } from './subtitles'
import type { Shot } from '../../core/models'

const props = withDefaults(
  defineProps<{
    shot: Shot
    playing?: boolean
    nextUrl?: string
  }>(),
  {
    playing: false,
    nextUrl: undefined,
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

// ---- A/B 双缓冲：当前段播放时预载下一段，切镜时瞬间切换，避免闪黑 ----
const videoA = ref<HTMLVideoElement | null>(null)
const videoB = ref<HTMLVideoElement | null>(null)
const activeEl = ref<'a' | 'b'>('a')
const activeVideo = computed(() => (activeEl.value === 'a' ? videoA.value : videoB.value))
const inactiveVideo = computed(() => (activeEl.value === 'a' ? videoB.value : videoA.value))
const preloadedUrl = ref<string | undefined>(undefined)

let hasStarted = false
let resumeTimer: ReturnType<typeof setInterval> | undefined

function setVideoSrc(el: HTMLVideoElement | null, url: string | undefined): void {
  if (!el) return
  if (!url) {
    el.removeAttribute('src')
    return
  }
  if (el.getAttribute('src') !== url) el.src = url
}

function playVideo(el: HTMLVideoElement | null): void {
  if (!el || !props.playing) return
  try {
    const result = el.play()
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {
    // 测试环境（jsdom）不支持媒体播放时静默
  }
}

function isActive(video: HTMLVideoElement | null): boolean {
  return video !== null && video === activeVideo.value
}

// 镜头/资产变化：预载命中则直接切换可见元素，否则当前元素换源
watch(
  () => [assetId.value, resolvedUrl.value, videoA.value, videoB.value] as const,
  () => {
    const url = resolvedUrl.value
    if (preloadedUrl.value && preloadedUrl.value === url && inactiveVideo.value) {
      activeEl.value = activeEl.value === 'a' ? 'b' : 'a'
      preloadedUrl.value = undefined
    } else {
      preloadedUrl.value = undefined
      setVideoSrc(activeVideo.value, url)
    }
    playVideo(activeVideo.value)
  },
  { immediate: true, flush: 'post' },
)

// 把下一段视频预载到非可见元素
watch(
  () => [props.nextUrl, videoA.value, videoB.value] as const,
  ([url]) => {
    if (!url) return
    setVideoSrc(inactiveVideo.value, url)
    preloadedUrl.value = url
  },
  { immediate: true, flush: 'post' },
)

// 切镜/重生成后重置“已开始播放”标志，避免加载期误报 pause 拉停连播
watch(
  () => assetId.value,
  () => {
    hasStarted = false
  },
  { immediate: true },
)

// 播放自愈：成片处于播放态时，若视频已加载却被暂停，自动恢复播放
watch(
  () => props.playing,
  (playing) => {
    if (playing && resumeTimer === undefined) {
      resumeTimer = setInterval(() => {
        const video = activeVideo.value
        if (!video || !props.playing) return
        if (video.paused && !video.ended && video.readyState >= 2) {
          playVideo(video)
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

function reportDuration(e: Event): void {
  const video = e.target as HTMLVideoElement
  if (!isActive(video)) return
  const d = video.duration
  if (Number.isFinite(d) && d > 0) {
    emit('video-duration', props.shot.id, d)
    // 切镜/重生成后元素刚挂载、src 未就绪时 play() 会被拒绝；元数据就绪后补一次播放
    playVideo(video)
  }
}

function onTimeUpdate(e: Event): void {
  const video = e.target as HTMLVideoElement
  if (!isActive(video)) return
  emit('video-time', props.shot.id, video.currentTime)
}

function onCanPlay(e: Event): void {
  const video = e.target as HTMLVideoElement
  if (!isActive(video)) return
  playVideo(video)
}

function onPlay(e: Event): void {
  if (!isActive(e.target as HTMLVideoElement)) return
  hasStarted = true
  emit('video-play', props.shot.id)
}

function onPause(e: Event): void {
  const video = e.target as HTMLVideoElement
  if (!isActive(video)) return
  // 加载/初始化阶段浏览器可能误发 pause：只有真正开始播放过后才同步成片状态
  if (!hasStarted) return
  // 自然播到结尾时浏览器会在 ended 前后触发 pause：不算用户暂停，不能拉停成片
  if (video.ended) return
  if (video.duration > 0 && video.currentTime >= video.duration - 0.15) return
  emit('video-pause', props.shot.id)
}

function onEnded(e: Event): void {
  if (!isActive(e.target as HTMLVideoElement)) return
  emit('video-ended', props.shot.id)
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
    <template v-else>
      <video
        ref="videoA"
        v-show="activeEl === 'a'"
        :data-test="activeEl === 'a' ? 'shot-video' : undefined"
        muted
        playsinline
        preload="auto"
        class="h-full w-full object-contain"
        @loadedmetadata="reportDuration"
        @durationchange="reportDuration"
        @timeupdate="onTimeUpdate"
        @canplay="onCanPlay"
        @loadeddata="onCanPlay"
        @ended="onEnded"
        @play="onPlay"
        @pause="onPause"
      />
      <video
        ref="videoB"
        v-show="activeEl === 'b'"
        :data-test="activeEl === 'b' ? 'shot-video' : undefined"
        muted
        playsinline
        preload="auto"
        class="h-full w-full object-contain"
        @loadedmetadata="reportDuration"
        @durationchange="reportDuration"
        @timeupdate="onTimeUpdate"
        @canplay="onCanPlay"
        @loadeddata="onCanPlay"
        @ended="onEnded"
        @play="onPlay"
        @pause="onPause"
      />
    </template>
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
