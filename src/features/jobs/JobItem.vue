<script setup lang="ts">
import { computed } from 'vue'
import { useJobStore } from '../../stores/jobStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useShotActions } from '../storyboard/useShotActions'
import { Badge, Progress } from '../../components/ui'
import { jobStatusInfo, jobTypeLabel } from './jobMeta'
import { capabilityForJobType } from '../../providers/capabilities'
import type { Job } from '../../core/models'

const props = defineProps<{ jobId: string }>()

const emit = defineEmits<{
  (e: 'locate', shotId: string): void
}>()

const jobStore = useJobStore()
const pluginStore = usePluginStore()
const storyboardStore = useStoryboardStore()

const job = computed<Job | undefined>(() => jobStore.getJob(props.jobId))
const isActive = computed<boolean>(
  () => job.value?.status === 'queued' || job.value?.status === 'running',
)
const canRetry = computed<boolean>(() => {
  const s = job.value?.status
  return !!job.value?.shotRef && (s === 'failed' || s === 'canceled')
})

const shotLabel = computed<string | undefined>(() => {
  const j = job.value
  if (!j?.shotRef) return undefined
  const index = storyboardStore.shots.findIndex((s) => s.id === j.shotRef)
  return index >= 0 ? `镜头 #${index + 1}` : `镜头 ${j.shotRef}`
})

const pluginName = computed<string | undefined>(() => {
  if (!job.value?.pluginId) return undefined
  const plugin = pluginStore.plugins.find((p) => p.id === job.value?.pluginId)
  return plugin?.name ?? job.value.pluginId
})

interface CancelableProvider {
  cancelJob: (id: string) => Promise<unknown>
}

// Provider resolution: prefer the owning pluginId so a provider swap between
// job creation and cancellation still cancels the right instance. Fall back to
// a job-type→capability mapping for jobs whose pluginId is absent.
function cancelProviderOf(j: Job): CancelableProvider | undefined {
  const byPlugin = pluginStore.getProviderInstance<CancelableProvider>(j.pluginId)
  if (byPlugin?.cancelJob) return byPlugin
  const cap = capabilityForJobType(j.type)
  if (cap) {
    const byCap = pluginStore.resolveInstanceCapability<CancelableProvider>('media', cap)
    if (byCap?.cancelJob) return byCap
  }
  if (j.type === 'tts') return pluginStore.ttsProvider
  return undefined
}

async function onCancel(): Promise<void> {
  const j = job.value
  if (!j || !isActive.value) return
  const provider = cancelProviderOf(j)
  if (provider) {
    try {
      await provider.cancelJob(j.id)
    } catch {
      // provider cancel failed; still mark the job canceled locally
    }
  }
  jobStore.markCanceled(j.id)
}

async function onRetry(): Promise<void> {
  const j = job.value
  if (!j?.shotRef) return
  try {
    const newJob = await useShotActions().generateMedia(j.shotRef)
    if (newJob) {
      jobStore.removeJob(j.id)
      return
    }
  } catch {
    // fall through to keep the failed job visible
  }
  jobStore.markFailed(j.id, '重试失败：媒体 Provider 不可用。')
}

async function onRemove(): Promise<void> {
  const j = job.value
  if (!j) return
  if (isActive.value) await onCancel()
  jobStore.removeJob(j.id)
}
</script>

<template>
  <div
    v-if="job"
    data-test="job-item"
    class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-3"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-sm font-medium text-ink">{{ jobTypeLabel(job.type) }}</span>
        <Badge :variant="jobStatusInfo(job.status).variant" data-test="job-status-badge">
          {{ jobStatusInfo(job.status).label }}
        </Badge>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          v-if="isActive"
          type="button"
          data-test="job-cancel"
          class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink"
          @click="onCancel"
        >
          取消
        </button>
        <button
          v-if="canRetry"
          type="button"
          data-test="job-retry"
          class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-amber-300"
          @click="onRetry"
        >
          重试
        </button>
        <button
          type="button"
          data-test="job-remove"
          aria-label="移除任务"
          class="rounded-md p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-red-400"
          @click="onRemove"
        >
          ✕
        </button>
      </div>
    </div>

    <div v-if="isActive" class="flex items-center gap-2">
      <Progress :value="job.progress" data-test="job-progress" class="min-w-0 flex-1" />
      <span class="shrink-0 text-xs text-ink-muted" data-test="job-progress-text">
        {{ job.progress }}%
      </span>
    </div>

    <div class="flex items-center gap-2 text-xs text-ink-muted">
      <span v-if="pluginName" data-test="job-plugin">{{ pluginName }}</span>
      <button
        v-if="job.shotRef"
        type="button"
        data-test="job-shot-link"
        class="truncate text-ink-muted transition-colors hover:text-amber-300"
        @click="emit('locate', job.shotRef ?? '')"
      >
        {{ shotLabel }}
      </button>
    </div>
  </div>
</template>
