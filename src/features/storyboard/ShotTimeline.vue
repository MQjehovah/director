<script setup lang="ts">
import { computed } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useShotActions } from './useShotActions'
import { Badge, Progress } from '../../components/ui'
import type { Job, Shot } from '../../core/models'

defineProps<{ selectedShotId?: string }>()

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const store = useStoryboardStore()
const actions = useShotActions()

const totalDuration = computed(() => store.shots.reduce((sum, s) => sum + durationOf(s), 0))

const shotTypeLabel: Record<Shot['shotType'], string> = {
  image: '静态图',
  video: '视频',
}

function durationOf(shot: Shot): number {
  return shot.camera?.duration ?? 4
}

function widthPct(shot: Shot): string {
  const denom = totalDuration.value
  const pct = denom > 0 ? (durationOf(shot) / denom) * 100 : 0
  return `${Math.max(pct, 6)}%`
}

function activeJobOf(shotId: string): Job | undefined {
  const job = actions.jobForShot(shotId)
  return job && (job.status === 'queued' || job.status === 'running') ? job : undefined
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-ink">时间轴</h2>
      <span class="text-xs text-ink-muted">总时长 {{ totalDuration }}s</span>
    </div>

    <div v-if="store.shots.length > 0" data-test="timeline" class="flex w-full items-stretch gap-1">
      <button
        v-for="(shot, index) in store.shots"
        :key="shot.id"
        type="button"
        data-test="timeline-shot"
        class="flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border border-edge bg-raised p-1 text-left transition-colors hover:border-zinc-600"
        :class="shot.id === selectedShotId ? 'border-amber-400/60' : ''"
        :style="{ flex: `1 1 ${widthPct(shot)}`, minWidth: '64px' }"
        @click="emit('select', shot.id)"
      >
        <span class="relative block aspect-video w-full overflow-hidden rounded border border-edge bg-zinc-900">
          <img
            v-if="shot.mediaAssets.length > 0 && actions.thumbUrl(shot.mediaAssets[0])"
            :src="actions.thumbUrl(shot.mediaAssets[0])"
            class="h-full w-full object-cover"
            alt=""
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
