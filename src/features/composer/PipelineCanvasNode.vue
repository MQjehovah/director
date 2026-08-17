<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { Badge, Switch } from '../../components/ui'
import type { StepStatusInfo } from './PipelineRunner'

export interface PipelineNodeData {
  kind: string
  label: string
  status: StepStatusInfo
  enabled: boolean
  running: boolean
  onToggle: (id: string, enabled: boolean) => void
  onRemove: (id: string) => void
}

defineProps<{
  id: string
  data: PipelineNodeData
}>()

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
</script>

<template>
  <div
    data-test="pipeline-node"
    class="relative w-52 rounded-lg border bg-panel p-3 shadow-xl"
    :class="[
      data.status.status === 'running'
        ? 'border-amber-400/70 ring-2 ring-amber-400/30'
        : data.status.status === 'failed'
          ? 'border-red-500/60'
          : 'border-edge',
    ]"
  >
    <Handle type="target" :position="Position.Top" class="!h-2 !w-2 !bg-zinc-500" />

    <div class="flex items-center gap-2">
      <span
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 text-[10px] font-semibold text-ink-muted"
      >
        {{ data.kind === 'assemble' ? '✓' : data.kind === 'script' ? '文' : '…' }}
      </span>
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ data.label }}</span>
      <button
        type="button"
        aria-label="删除节点"
        data-test="node-remove"
        class="rounded p-0.5 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-red-400"
        @click="data.onRemove(id)"
      >
        ×
      </button>
    </div>

    <div class="mt-2 flex items-center gap-2">
      <Badge :variant="statusVariant(data.status.status)">
        {{ statusLabel(data.status.status) }}
      </Badge>
      <span class="ml-auto flex items-center gap-1">
        <Switch
          :model-value="data.enabled"
          :disabled="data.running"
          @update:model-value="data.onToggle(id, $event)"
        />
      </span>
    </div>

    <p v-if="data.status.error" class="mt-2 break-words text-xs text-red-400">
      {{ data.status.error }}
    </p>

    <Handle type="source" :position="Position.Bottom" class="!h-2 !w-2 !bg-zinc-500" />
  </div>
</template>
