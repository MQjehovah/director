<script setup lang="ts">
import { computed, markRaw, onMounted, ref } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { Button, Input } from '../../components/ui'
import PipelineCanvasNode from './PipelineCanvasNode.vue'
import type { PipelineNodeData } from './PipelineCanvasNode.vue'
import {
  assembleStep,
  cutStep,
  portraitStep,
  presetPipeline,
  renderStep,
  sceneArtStep,
  scriptStep,
  voiceStep,
} from './presetSteps'
import { PipelineRunner } from './PipelineRunner'
import type { PipelineStep, RunReport, StepStatusInfo } from './PipelineRunner'
import type { NodeComponent } from '@vue-flow/core'

interface StepDef {
  kind: string
  label: string
  factory: () => PipelineStep
}

const STEP_DEFS: StepDef[] = [
  { kind: 'script', label: '生成剧本', factory: scriptStep },
  { kind: 'cut', label: '切分镜头', factory: cutStep },
  { kind: 'scene-art', label: '生成场景图', factory: sceneArtStep },
  { kind: 'portrait', label: '生成立绘', factory: portraitStep },
  { kind: 'render', label: '生成画面', factory: renderStep },
  { kind: 'voice', label: '配音', factory: voiceStep },
  { kind: 'assemble', label: '组装成片', factory: assembleStep },
]

const idea = ref('')
const report = ref<RunReport | null>(null)
const running = ref(false)
const nodeTypes = { pipeline: markRaw(PipelineCanvasNode) as unknown as NodeComponent }

const {
  addNodes,
  addEdges,
  removeNodes,
  removeEdges,
  getNodes,
  getEdges,
  fitView,
  onConnect,
  onNodeDragStop,
} = useVueFlow()

function makeNodeData(kind: string, label: string): PipelineNodeData {
  return {
    kind,
    label,
    status: { status: 'pending' },
    enabled: true,
    running: running.value,
    onToggle: (id, enabled) => {
      const node = getNodes.value.find((n) => n.id === id)
      if (node) node.data.enabled = enabled
    },
    onRemove: (id) => {
      removeNodes([id])
      const orphan = getEdges.value.filter((e) => e.source === id || e.target === id)
      if (orphan.length > 0) removeEdges(orphan.map((e) => e.id))
    },
  }
}

function initGraph(): void {
  const preset = presetPipeline()
  const initial = preset.map((step, index) => ({
    id: step.id,
    type: 'pipeline',
    position: { x: 260, y: index * 190 },
    data: makeNodeData(step.id, step.title || step.id),
  }))
  addNodes(initial)
  addEdges(
    initial.slice(0, -1).map((node, i) => ({
      id: `${node.id}->${initial[i + 1].id}`,
      source: node.id,
      target: initial[i + 1].id,
    })),
  )
}

onMounted(initGraph)

function addStepNode(kind: string): void {
  const def = STEP_DEFS.find((d) => d.kind === kind)
  if (!def) return
  const id = `${kind}-${Date.now().toString(36)}`
  const count = getNodes.value.length
  addNodes({
    id,
    type: 'pipeline',
    position: { x: 260 + (count % 4) * 40, y: count * 190 + 60 },
    data: makeNodeData(kind, def.label),
  })
}

onConnect((connection) => {
  if (!connection.source || !connection.target) return
  const id = `${connection.source}->${connection.target}`
  if (getEdges.value.some((e) => e.id === id)) return
  addEdges([
    {
      id,
      source: connection.source,
      target: connection.target,
    },
  ])
})

onNodeDragStop(({ node }) => {
  const stored = getNodes.value.find((n) => n.id === node.id)
  if (stored) stored.position = node.position
})

const selectedEdges = computed(() => getEdges.value.filter((e) => e.selected))

function removeSelectedEdges(): void {
  if (selectedEdges.value.length === 0) return
  removeEdges(selectedEdges.value.map((e) => e.id))
}

function setStatus(id: string, status: StepStatusInfo): void {
  const node = getNodes.value.find((n) => n.id === id)
  if (node) node.data.status = status
}

/** 按画布连线做拓扑排序，孤立节点按纵向位置追加 */
function orderedSteps(): PipelineStep[] {
  const nodes = getNodes.value
  const edges = getEdges.value
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const node of nodes) {
    indegree.set(node.id, 0)
    adj.set(node.id, [])
  }
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue
    adj.get(edge.source)!.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = [...nodes.map((n) => n.id)].filter((id) => indegree.get(id) === 0)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  const placed = new Set(order)
  const isolated = nodes
    .filter((n) => !placed.has(n.id))
    .sort((a, b) => a.position.y - b.position.y)
    .map((n) => n.id)
  return [...order, ...isolated].map((id) => {
    const node = nodes.find((n) => n.id === id)!
    const def = STEP_DEFS.find((d) => d.kind === node.data.kind)
    const step = def?.factory() ?? {
      id,
      title: node.data.label,
      enabled: true,
      run: async () => undefined,
    }
    step.enabled = node.data.enabled !== false
    return step
  })
}

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
  if (running.value) return
  const steps = orderedSteps()
  if (steps.length === 0) {
    report.value = {
      ok: false,
      results: {},
      errors: { pipeline: '画布为空，请先添加节点。' },
      completed: [],
    }
    return
  }
  running.value = true
  for (const node of getNodes.value) {
    node.data.status = { status: 'pending' }
    node.data.running = true
  }
  const runner = new PipelineRunner({
    input: idea.value.trim() || undefined,
    onStepStart: (id) => setStatus(id, { status: 'running' }),
    onStepDone: (id, status, error) => {
      setStatus(id, { status, ...(error ? { error } : {}) })
    },
  })
  report.value = await runner.run(steps)
  running.value = false
  for (const node of getNodes.value) {
    node.data.running = false
  }
  void fitView()
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

const errorLines = computed(() => (report.value ? Object.entries(report.value.errors) : []))
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4">
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
        :disabled="running"
        data-test="run-all"
        @click="runAll"
      >
        {{ running ? '执行中…' : '一键全流程' }}
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="shrink-0"
        :disabled="selectedEdges.length === 0 || running"
        data-test="remove-edges"
        @click="removeSelectedEdges"
      >
        删除选中连线
      </Button>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-raised p-2">
      <span class="text-xs text-ink-muted">添加节点：</span>
      <Button
        v-for="def in STEP_DEFS"
        :key="def.kind"
        size="sm"
        variant="ghost"
        class="shrink-0"
        :disabled="running"
        :data-test="`add-node-${def.kind}`"
        @click="addStepNode(def.kind)"
      >
        ＋{{ def.label }}
      </Button>
    </div>

    <div class="canvas-grid relative min-h-0 flex-1 overflow-hidden rounded-lg border border-edge bg-zinc-950">
      <VueFlow
        :node-types="nodeTypes"
        :nodes-draggable="!running"
        :nodes-connectable="true"
        :min-zoom="0.2"
        :max-zoom="2"
        :fit-view-on-init="true"
        class="h-full w-full"
      >
        <Background :gap="24" :size="1" />
      </VueFlow>
    </div>

    <div
      data-test="report"
      class="flex flex-col gap-1 rounded-lg border border-edge bg-panel p-3"
    >
      <template v-if="report">
        <p class="text-sm font-medium" :class="report.ok ? 'text-emerald-300' : 'text-red-300'">
          {{ report.ok ? '全流程完成' : '全流程结束（存在失败步骤）' }}
        </p>
        <p v-if="summary" class="text-xs text-ink-muted">{{ summary }}</p>
        <ul v-if="errorLines.length > 0" class="flex flex-col gap-0.5">
          <li v-for="[id, error] in errorLines" :key="id" class="text-xs text-red-400">
            {{ id }}：{{ error }}
          </li>
        </ul>
      </template>
      <p v-else class="text-sm text-ink-muted">
        拖拽节点编排顺序：从节点底部连线到下一节点顶部；点「一键全流程」按连线顺序执行。
      </p>
    </div>
  </div>
</template>

<style scoped>
.canvas-grid {
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
}
</style>
