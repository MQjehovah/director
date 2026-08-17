<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useShotActions } from '../storyboard/useShotActions'
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
  (assetId) => {
    resolvedUrl.value = undefined
    if (!assetId) return
    void actions.resolveAssetUrl(assetId).then((url) => {
      resolvedUrl.value = url
    })
  },
  { immediate: true },
)

type CameraMove = NonNullable<Shot['camera']>['move']

const MOVE_TRANSFORMS: Record<CameraMove, string> = {
  static: 'scale(1.2)',
  'zoom-in': 'scale(1.35)',
  'zoom-out': 'scale(1.1)',
  pan: 'translateX(-5%) scale(1.25)',
  tilt: 'translateY(-5%) scale(1.25)',
  tracking: 'translateX(5%) scale(1.25)',
}

const duration = computed(() => props.shot.camera?.duration ?? 4)

const displayAsImage = computed(() => {
  const url = resolvedUrl.value
  if (!url) return true
  return props.shot.shotType === 'image' || url.startsWith('data:image')
})

const kenBurnsTransform = computed(
  () => MOVE_TRANSFORMS[props.shot.camera?.move ?? 'static'] ?? MOVE_TRANSFORMS.static,
)

const imageStyle = computed(() => ({
  transform: props.playing ? kenBurnsTransform.value : 'scale(1.05)',
  transition: `transform ${duration.value}s ease-in-out`,
}))
</script>

<template>
  <div class="relative aspect-video w-full overflow-hidden bg-zinc-950" data-test="shot-player">
    <template v-if="displayAsImage">
      <img
        v-if="resolvedUrl"
        :src="resolvedUrl"
        :style="imageStyle"
        class="h-full w-full object-cover"
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
