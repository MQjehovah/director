<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useShotActions } from '../storyboard/useShotActions'
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

const actions = useShotActions()
const resolvedUrl = ref<string | undefined>(undefined)

watch(
  () => props.shot.mediaAssets[0],
  (assetId, _old, onCleanup) => {
    resolvedUrl.value = undefined
    if (!assetId) return
    let cancelled = false
    void actions.resolveAssetUrl(assetId).then((url) => {
      if (!cancelled) resolvedUrl.value = url
    })
    onCleanup(() => {
      cancelled = true
    })
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
      :key="shot.id"
      :src="resolvedUrl"
      controls
      muted
      :autoplay="playing"
      class="h-full w-full object-cover"
      data-test="shot-video"
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
