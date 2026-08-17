<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, Input } from '../../components/ui'
import PipelineEditor from './PipelineEditor.vue'
import { presetPipeline } from './presetSteps'
import type { PipelineStep, RunReport } from './PipelineRunner'

const steps = ref<PipelineStep[]>(presetPipeline())
const idea = ref('')
const report = ref<RunReport | null>(null)
const editorRef = ref<{ run: () => Promise<RunReport> } | null>(null)

async function runAll(): Promise<void> {
  if (!idea.value.trim()) {
    report.value = {
      ok: false,
      results: {},
      errors: { pipeline: '请先填写故事梗概。' },
      completed: [],
    }
    return
  }
  await editorRef.value?.run()
}

function onToggle(payload: { id: string; enabled: boolean }): void {
  const step = steps.value.find((s) => s.id === payload.id)
  if (step) step.enabled = payload.enabled
}

function onMove(payload: { from: number; to: number }): void {
  const next = [...steps.value]
  const [moved] = next.splice(payload.from, 1)
  next.splice(payload.to, 0, moved)
  steps.value = next
}

const summary = computed(() => {
  if (!report.value) return ''
  const r = report.value
  const script = r.results['script'] as { sceneCount?: number } | undefined
  const cut = r.results['cut'] as { shotCount?: number } | undefined
  const render = r.results['render'] as { renderCount?: number } | undefined
  const parts: string[] = []
  if (script?.sceneCount !== undefined) parts.push(`剧本 ${script.sceneCount} 场`)
  if (cut?.shotCount !== undefined) parts.push(`镜头 ${cut.shotCount} 个`)
  if (render?.renderCount !== undefined) parts.push(`生成任务 ${render.renderCount} 个`)
  return parts.join(' / ')
})

const errorLines = computed(() => {
  if (!report.value) return []
  return Object.entries(report.value.errors)
})
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-raised p-3">
      <label class="shrink-0 text-sm text-ink-muted" for="composer-idea">故事梗概</label>
      <Input
        id="composer-idea"
        v-model="idea"
        placeholder="例如：都市少年与 AI 伙伴的冒险"
        data-test="idea-input"
        class="min-w-0 flex-1"
      />
      <Button
        variant="primary"
        size="sm"
        class="shrink-0"
        data-test="run-all"
        @click="runAll"
      >
        一键全流程
      </Button>
    </div>

    <div class="min-w-0 flex-1 overflow-y-auto">
      <PipelineEditor
        ref="editorRef"
        :steps="steps"
        :input="idea.trim() || undefined"
        @toggle="onToggle"
        @move="onMove"
        @done="report = $event"
      />
    </div>

    <div
      data-test="report"
      class="flex flex-col gap-1 rounded-lg border border-edge bg-panel p-3"
    >
      <template v-if="report">
        <p
          class="text-sm font-medium"
          :class="report.ok ? 'text-emerald-300' : 'text-red-300'"
        >
          {{ report.ok ? '全流程完成' : '全流程结束（存在失败步骤）' }}
        </p>
        <p v-if="summary" class="text-xs text-ink-muted">{{ summary }}</p>
        <ul v-if="errorLines.length > 0" class="flex flex-col gap-0.5">
          <li v-for="[id, error] in errorLines" :key="id" class="text-xs text-red-400">
            {{ id }}：{{ error }}
          </li>
        </ul>
      </template>
      <p v-else class="text-sm text-ink-muted">点击「一键全流程」开始执行。</p>
    </div>
  </div>
</template>
