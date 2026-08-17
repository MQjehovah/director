<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Switch, Badge } from '../../components/ui'
import { PipelineRunner } from './PipelineRunner'
import type { PipelineStep, RunReport, StepStatusInfo } from './PipelineRunner'

const props = defineProps<{
  steps: PipelineStep[]
  input?: unknown
}>()

const emit = defineEmits<{
  (e: 'toggle', payload: { id: string; enabled: boolean }): void
  (e: 'move', payload: { from: number; to: number }): void
  (e: 'done', report: RunReport): void
}>()

const statuses = ref<Record<string, StepStatusInfo>>({})
const running = ref(false)

function statusOf(step: PipelineStep): StepStatusInfo {
  const info = statuses.value[step.id]
  if (step.enabled === false || step.skip === true) return { status: 'skipped' }
  return info ?? { status: 'pending' }
}

function statusLabel(status: StepStatusInfo['status']): string {
  switch (status) {
    case 'running':
      return '执行中'
    case 'done':
      return '已完成'
    case 'failed':
      return '失败'
    case 'skipped':
      return '已跳过'
    default:
      return '待执行'
  }
}

function statusVariant(
  status: StepStatusInfo['status'],
): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'done':
      return 'success'
    case 'failed':
      return 'danger'
    case 'running':
      return 'warning'
    default:
      return 'neutral'
  }
}

function move(delta: -1 | 1, index: number): void {
  const to = index + delta
  if (to < 0 || to >= props.steps.length) return
  emit('move', { from: index, to })
}

async function run(): Promise<RunReport> {
  if (running.value) return { ok: false, results: {}, errors: {}, completed: [] }
  running.value = true
  statuses.value = {}
  const runner = new PipelineRunner({
    input: props.input,
    onStepStart: (id) => {
      statuses.value = { ...statuses.value, [id]: { status: 'running' } }
    },
    onStepDone: (id, status, error) => {
      statuses.value = { ...statuses.value, [id]: { status, ...(error ? { error } : {}) } }
    },
  })
  const report = await runner.run(props.steps)
  running.value = false
  emit('done', report)
  return report
}

defineExpose({ run })

const hasSkipped = computed(() =>
  props.steps.some((s) => s.enabled === false || s.skip === true),
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-ink">全流程步骤</h2>
      <span class="text-xs text-ink-muted">共 {{ steps.length }} 步</span>
    </div>

    <div class="flex flex-col gap-2">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        data-test="step-row"
        class="flex items-center gap-3 rounded-lg border border-edge bg-raised p-3"
        :class="statusOf(step).status === 'running' ? 'ring-1 ring-amber-400/40' : ''"
      >
        <span class="flex w-5 shrink-0 justify-center text-xs font-semibold text-ink-muted">
          {{ index + 1 }}
        </span>
        <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ step.title || step.id }}</span>

        <Badge :variant="statusVariant(statusOf(step).status)" data-test="step-status">
          {{ statusLabel(statusOf(step).status) }}
        </Badge>

        <span v-if="statusOf(step).error" class="max-w-[16rem] truncate text-xs text-red-400" data-test="step-error">
          {{ statusOf(step).error }}
        </span>

        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="前移"
            data-test="step-move-up"
            :disabled="index === 0 || running"
            class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink disabled:opacity-40"
            @click="move(-1, index)"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="后移"
            data-test="step-move-down"
            :disabled="index === steps.length - 1 || running"
            class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink disabled:opacity-40"
            @click="move(1, index)"
          >
            ↓
          </button>
        </div>

        <Switch
          :model-value="step.enabled !== false"
          label="启用"
          data-test="step-toggle"
          :disabled="running"
          @update:model-value="emit('toggle', { id: step.id, enabled: $event })"
        />
      </div>
    </div>

    <p v-if="hasSkipped" class="text-xs text-ink-muted">已禁用的步骤将被跳过。</p>

    <div class="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        :disabled="running"
        data-test="run-pipeline"
        @click="void run()"
      >
        {{ running ? '执行中…' : '执行管道' }}
      </Button>
    </div>
  </div>
</template>
