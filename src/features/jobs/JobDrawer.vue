<script setup lang="ts">
import { computed } from 'vue'
import { useJobStore } from '../../stores/jobStore'
import { Button } from '../../components/ui'
import JobItem from './JobItem.vue'
import type { Job } from '../../core/models'

defineProps<{
  open?: boolean
  inline?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'locate', shotId: string): void
}>()

const jobStore = useJobStore()

const counts = computed<Record<Job['status'], number>>(() => {
  const c: Record<Job['status'], number> = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    canceled: 0,
  }
  for (const j of jobStore.jobs) c[j.status] += 1
  return c
})

const summarySegments = computed<string[]>(() => {
  const c = counts.value
  const segments: string[] = []
  if (c.queued > 0) segments.push(`${c.queued} 排队中`)
  if (c.running > 0) segments.push(`${c.running} 生成中`)
  if (c.done > 0) segments.push(`${c.done} 已完成`)
  if (c.failed > 0) segments.push(`${c.failed} 失败`)
  if (c.canceled > 0) segments.push(`${c.canceled} 已取消`)
  return segments
})
</script>

<template>
  <div
    v-if="open"
    data-test="jobs-drawer"
    :class="inline ? 'flex h-full flex-col bg-panel' : 'fixed inset-0 z-50 flex justify-end'"
  >
    <div
      v-if="!inline"
      class="absolute inset-0 bg-black/50"
      data-test="drawer-backdrop"
      aria-hidden="true"
      @click="emit('close')"
    />
    <aside
      :class="[
        'relative flex flex-col bg-panel',
        inline
          ? 'min-h-0 flex-1 border border-edge'
          : 'h-full w-80 max-w-full border-l border-edge shadow-2xl',
      ]"
    >
      <header class="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">任务队列</h2>
          <p class="text-xs text-ink-muted">共 {{ jobStore.jobs.length }} 个任务</p>
        </div>
        <Button size="sm" variant="ghost" data-test="drawer-close" @click="emit('close')">
          关闭
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <p v-if="jobStore.jobs.length === 0" data-test="jobs-empty" class="text-sm text-ink-muted">
          暂无任务
        </p>
        <div v-else class="flex flex-col gap-2">
          <JobItem
            v-for="j in jobStore.jobs"
            :key="j.id"
            :job-id="j.id"
            @locate="emit('locate', $event)"
          />
        </div>
      </div>

      <footer class="shrink-0 border-t border-edge px-4 py-3">
        <p data-test="jobs-summary" class="text-xs text-ink-muted">
          {{ summarySegments.length > 0 ? summarySegments.join(' · ') : '空闲' }}
        </p>
      </footer>
    </aside>
  </div>
</template>
