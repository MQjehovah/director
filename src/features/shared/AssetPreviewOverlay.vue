<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAssetPreview } from './assetPreview'

const { previewState, closePreview } = useAssetPreview()

const MIN_SCALE = 0.25
const MAX_SCALE = 8

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
let dragging = false
let lastX = 0
let lastY = 0

function resetView(): void {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

function clampScale(value: number): number {
  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE)
}

/** 以指定屏幕坐标（相对媒体容器左上角）为锚点缩放，未指定时围绕中心 */
function zoomBy(factor: number, anchorX?: number, anchorY?: number): void {
  const next = clampScale(scale.value * factor)
  const ratio = next / scale.value
  if (anchorX !== undefined && anchorY !== undefined) {
    tx.value = anchorX - (anchorX - tx.value) * ratio
    ty.value = anchorY - (anchorY - ty.value) * ratio
  } else {
    tx.value *= ratio
    ty.value *= ratio
  }
  scale.value = next
}

function zoomIn(): void {
  zoomBy(1.25)
}

function zoomOut(): void {
  zoomBy(1 / 1.25)
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
}

function onDown(e: MouseEvent): void {
  if (e.button !== 0) return
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}

function onMove(e: MouseEvent): void {
  if (!dragging) return
  tx.value += e.clientX - lastX
  ty.value += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
}

function onUp(): void {
  dragging = false
}

function onDoubleClick(): void {
  if (scale.value > 1) resetView()
  else zoomBy(2)
}

const mediaStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
}))

const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePreview()
}

watch(
  () => previewState.open,
  (open) => {
    if (open) {
      resetView()
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="previewState.open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      data-test="asset-preview-overlay"
      @click.self="closePreview"
      @mousemove="onMove"
      @mouseup="onUp"
      @mouseleave="onUp"
    >
      <button
        type="button"
        aria-label="关闭"
        title="关闭"
        data-test="asset-preview-close"
        class="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-xl leading-none text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
        @click="closePreview"
      >
        ×
      </button>

      <figure class="flex max-h-full max-w-full flex-col items-center gap-2">
        <figcaption
          v-if="previewState.title"
          class="max-w-full truncate text-xs text-zinc-400"
          data-test="asset-preview-title"
        >
          {{ previewState.title }}
        </figcaption>
        <div
          class="relative max-h-[82vh] max-w-full touch-none overflow-hidden rounded"
          data-test="asset-preview-stage"
          @wheel.prevent="onWheel"
        >
          <img
            v-if="previewState.kind === 'image'"
            :src="previewState.url"
            :style="mediaStyle"
            class="max-h-[82vh] max-w-full cursor-grab select-none object-contain shadow-2xl active:cursor-grabbing"
            draggable="false"
            alt=""
            data-test="asset-preview-image"
            @mousedown="onDown"
            @dblclick="onDoubleClick"
          />
          <video
            v-else
            :src="previewState.url"
            controls
            autoplay
            playsinline
            :style="mediaStyle"
            class="max-h-[82vh] max-w-full cursor-grab select-none object-contain shadow-2xl active:cursor-grabbing"
            data-test="asset-preview-video"
            @mousedown="onDown"
            @dblclick="onDoubleClick"
          />
        </div>
      </figure>

      <div
        class="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 py-1 text-xs text-zinc-300"
        data-test="asset-preview-zoom-bar"
      >
        <button
          type="button"
          aria-label="缩小"
          title="缩小"
          data-test="asset-preview-zoom-out"
          class="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
          @click="zoomOut"
        >
          −
        </button>
        <span class="w-12 text-center" data-test="asset-preview-zoom-label">
          {{ zoomLabel }}
        </span>
        <button
          type="button"
          aria-label="放大"
          title="放大"
          data-test="asset-preview-zoom-in"
          class="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
          @click="zoomIn"
        >
          +
        </button>
        <button
          type="button"
          title="重置视图"
          data-test="asset-preview-reset"
          class="ml-1 rounded-full px-2 py-1 transition-colors hover:bg-white/10 hover:text-white"
          @click="resetView"
        >
          重置
        </button>
      </div>
    </div>
  </Teleport>
</template>
