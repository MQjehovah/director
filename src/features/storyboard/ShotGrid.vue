<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useShotActions } from './useShotActions'
import { Badge, Progress } from '../../components/ui'
import type { Job, Shot } from '../../core/models'

const props = withDefaults(
  defineProps<{
    selectedShotId?: string
    shots?: Shot[]
  }>(),
  { shots: undefined },
)

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'remove', id: string): void
}>()

const store = useStoryboardStore()
const actions = useShotActions()

const dragId = ref<string | undefined>(undefined)

// 传入 shots 时按传入渲染（分组场景用），否则渲染 store 全部镜头
const visibleShots = computed<Shot[]>(() => props.shots ?? store.shots)

const assetIds = computed(() => visibleShots.value.flatMap((s) => s.mediaAssets))

watch(
  assetIds,
  (ids) => {
    for (const id of ids) void actions.resolveAssetUrl(id)
  },
  { immediate: true },
)

const shotTypeLabel: Record<Shot['shotType'], string> = {
  image: '静态图',
  video: '视频',
}

function thumbUrlOf(assetId: string | undefined): string | undefined {
  return assetId ? actions.thumbUrl(assetId) : undefined
}

function thumbIsVideo(assetId: string | undefined): boolean {
  const url = thumbUrlOf(assetId)
  if (!url) return false
  if (url.startsWith('data:video') || url.startsWith('blob:video')) return true
  if (url.startsWith('http')) return /\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(url)
  return false
}

function activeJobOf(shotId: string): Job | undefined {
  const job = actions.jobForShot(shotId)
  return job && (job.status === 'queued' || job.status === 'running') ? job : undefined
}

function statusInfo(
  shotId: string,
): { text: string; variant: 'neutral' | 'warning' | 'success' | 'danger' } | undefined {
  const job = actions.jobForShot(shotId)
  if (!job) return undefined
  switch (job.status) {
    case 'queued':
      return { text: '排队中', variant: 'warning' }
    case 'running':
      return { text: '生成中', variant: 'warning' }
    case 'done':
      return { text: '已生成', variant: 'success' }
    case 'failed':
      return { text: '失败', variant: 'danger' }
    case 'canceled':
      return { text: '已取消', variant: 'neutral' }
  }
}

function move(delta: -1 | 1, shotId: string): void {
  const from = store.shots.findIndex((s) => s.id === shotId)
  if (from < 0) return
  store.moveShot(from, from + delta)
}

async function removeShot(id: string): Promise<void> {
  await actions.cancelGeneration(id)
  store.removeShot(id)
  emit('remove', id)
}

function onDragStart(e: DragEvent, shotId: string): void {
  dragId.value = shotId
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(e: DragEvent, shotId: string): void {
  e.preventDefault()
  const fromId = dragId.value
  dragId.value = undefined
  if (!fromId || fromId === shotId) return
  const from = store.shots.findIndex((s) => s.id === fromId)
  const to = store.shots.findIndex((s) => s.id === shotId)
  if (from < 0 || to < 0) return
  store.moveShot(from, to)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-ink">分镜</h2>
      <span class="text-xs text-ink-muted">共 {{ store.shots.length }} 个镜头</span>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div
        v-for="(shot, index) in store.shots"
        :key="shot.id"
        data-test="shot-card"
        draggable="true"
        class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-3 transition-colors"
        :class="[
          shot.id === selectedShotId ? 'border-amber-400/60 ring-1 ring-amber-400/40' : '',
          dragId === shot.id ? 'opacity-50' : '',
        ]"
        @dragstart="onDragStart($event, shot.id)"
        @dragover="onDragOver"
        @drop="onDrop($event, shot.id)"
        @dragend="dragId = undefined"
      >
        <button
          type="button"
          data-test="shot-select"
          class="block w-full text-left"
          @click="emit('select', shot.id)"
        >
          <span
            class="relative block aspect-video w-full overflow-hidden rounded-md border border-edge bg-zinc-900"
          >
            <video
              v-if="thumbIsVideo(shot.mediaAssets[0])"
              :src="actions.thumbUrl(shot.mediaAssets[0])"
              data-test="shot-thumb-video"
              muted
              playsinline
              preload="metadata"
              class="h-full w-full object-cover"
            />
            <img
              v-else-if="shot.mediaAssets.length > 0 && actions.thumbUrl(shot.mediaAssets[0])"
              :src="actions.thumbUrl(shot.mediaAssets[0])"
              data-test="shot-thumb-img"
              class="h-full w-full object-cover"
              alt=""
            />
            <span
              v-else
              data-test="shot-placeholder"
              class="flex h-full w-full items-center justify-center text-xs text-ink-muted"
            >
              {{ activeJobOf(shot.id) ? '生成中…' : '待生成' }}
            </span>
            <span
              class="absolute left-1 top-1 rounded bg-zinc-950/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200"
            >
              {{ index + 1 }}
            </span>
          </span>
          <span class="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{{ shotTypeLabel[shot.shotType] }}</Badge>
            <span class="text-[10px] text-ink-muted">{{ shot.camera?.duration ?? 5 }}s</span>
            <Badge v-if="statusInfo(shot.id)" :variant="statusInfo(shot.id)?.variant">
              {{ statusInfo(shot.id)?.text }}
            </Badge>
          </span>
        </button>

        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1">
            <button
              type="button"
              aria-label="前移"
              data-test="shot-move-up"
              :disabled="index === 0"
              class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink disabled:opacity-40"
              @click="move(-1, shot.id)"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="后移"
              data-test="shot-move-down"
              :disabled="index === visibleShots.length - 1"
              class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink disabled:opacity-40"
              @click="move(1, shot.id)"
            >
              ↓
            </button>
          </div>
          <button
            type="button"
            aria-label="删除镜头"
            data-test="shot-remove"
            class="rounded-md p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-red-400"
            @click="removeShot(shot.id)"
          >
            ✕
          </button>
        </div>

        <Progress
          v-if="activeJobOf(shot.id)"
          :value="activeJobOf(shot.id)?.progress ?? 0"
          data-test="shot-progress"
        />
      </div>
    </div>
  </div>
</template>
