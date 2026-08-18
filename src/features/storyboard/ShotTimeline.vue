<script setup lang="ts">
import { computed, watch } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { displayAssetOf, useShotActions } from './useShotActions'
import { useAssetPreview } from '../shared/assetPreview'
import { Badge, Progress } from '../../components/ui'
import type { Job, Shot } from '../../core/models'

defineProps<{ selectedShotId?: string }>()

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const store = useStoryboardStore()
const actions = useShotActions()
const { openPreview } = useAssetPreview()

const assetIds = computed(() => store.shots.flatMap((s) => s.mediaAssets))

watch(
  assetIds,
  (ids) => {
    for (const id of ids) void actions.resolveAssetUrl(id)
  },
  { immediate: true },
)

const totalDuration = computed(() => store.shots.reduce((sum, s) => sum + durationOf(s), 0))

const shotTypeLabel: Record<Shot['shotType'], string> = {
  image: '静态图',
  video: '视频',
}

function durationOf(shot: Shot): number {
  return shot.camera?.duration ?? 5
}

function activeJobOf(shotId: string): Job | undefined {
  const job = actions.jobForShot(shotId)
  return job && (job.status === 'queued' || job.status === 'running') ? job : undefined
}

function thumbUrlOf(assetId: string | undefined): string | undefined {
  return assetId ? actions.thumbUrl(assetId) : undefined
}

function thumbIsVideo(assetId: string | undefined): boolean {
  const url = thumbUrlOf(assetId)
  if (!url) return false
  if (url.startsWith('data:video') || url.startsWith('blob:video')) return true
  if (url.startsWith('http')) return /\.(mp4|m4v|webm|mov)([?#&]|$)/i.test(url)
  return false
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-ink">时间轴</h2>
      <span class="text-xs text-ink-muted">总时长 {{ totalDuration }}s</span>
    </div>

    <div
      v-if="store.shots.length > 0"
      data-test="timeline"
      class="flex w-full items-stretch gap-1 overflow-x-auto"
    >
      <button
        v-for="(shot, index) in store.shots"
        :key="shot.id"
        type="button"
        data-test="timeline-shot"
        class="flex min-w-40 flex-1 flex-col gap-1 overflow-hidden rounded-md border border-edge bg-raised p-1 text-left transition-colors hover:border-zinc-600"
        :class="shot.id === selectedShotId ? 'border-amber-400/60' : ''"
        @click="emit('select', shot.id)"
      >
        <span class="relative block aspect-video w-full overflow-hidden rounded border border-edge bg-zinc-900">
          <video
            v-if="thumbIsVideo(displayAssetOf(shot))"
            :src="actions.thumbUrl(displayAssetOf(shot))"
            data-test="timeline-thumb-video"
            muted
            playsinline
            preload="metadata"
            class="h-full w-full cursor-zoom-in object-cover"
            @click.stop="openPreview(actions.thumbUrl(displayAssetOf(shot))!, 'video')"
          />
          <img
            v-else-if="shot.mediaAssets.length > 0 && actions.thumbUrl(displayAssetOf(shot))"
            :src="actions.thumbUrl(displayAssetOf(shot))"
            class="h-full w-full cursor-zoom-in object-cover"
            alt=""
            @click.stop="openPreview(actions.thumbUrl(displayAssetOf(shot))!, 'image')"
          />
          <span v-else class="flex h-full w-full items-center justify-center text-[10px] text-ink-muted">
            {{ activeJobOf(shot.id) ? '生成中…' : '待生成' }}
          </span>
        </span>
        <span class="flex items-center gap-1">
          <span class="text-[10px] font-medium text-ink">{{ index + 1 }}</span>
          <Badge>{{ shotTypeLabel[shot.shotType] }}</Badge>
          <span class="ml-auto text-[10px] text-ink-muted">{{ durationOf(shot) }}s</span>
        </span>
        <Progress v-if="activeJobOf(shot.id)" :value="activeJobOf(shot.id)?.progress ?? 0" />
      </button>
    </div>
    <p v-else class="text-sm text-ink-muted">暂无镜头。</p>
  </div>
</template>
