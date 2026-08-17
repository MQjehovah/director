<script setup lang="ts">
import { ref } from 'vue'
import { Button, Input, Textarea } from '../../components/ui'
import {
  deleteWorkflowTemplate,
  importWorkflowGraph,
  listWorkflowTemplates,
  saveWorkflowTemplate,
} from '../comfyui/workflowStore'
import type { WorkflowTemplate } from '../comfyui/workflowStore'
import { saveProviderConfig } from './httpBackendConfig'
import { MEDIA_COMFYUI_ID } from '../../plugins/providers/media-comfyui'

const name = ref('')
const graphJson = ref('')
const draft = ref<WorkflowTemplate | undefined>(undefined)
const message = ref<{ kind: 'error' | 'success'; text: string } | undefined>(undefined)
const templates = ref<WorkflowTemplate[]>(listWorkflowTemplates())

function refresh(): void {
  templates.value = listWorkflowTemplates()
}

function onImport(): void {
  message.value = undefined
  draft.value = undefined
  const result = importWorkflowGraph(graphJson.value, name.value.trim() || '未命名模板')
  if ('error' in result) {
    message.value = { kind: 'error', text: result.error }
    return
  }
  draft.value = result
}

function onSave(): void {
  if (!draft.value) return
  saveWorkflowTemplate(draft.value)
  draft.value = undefined
  graphJson.value = ''
  name.value = ''
  message.value = { kind: 'success', text: '模板已保存' }
  refresh()
}

function onDelete(id: string): void {
  deleteWorkflowTemplate(id)
  refresh()
}

function onUse(id: string): void {
  saveProviderConfig(MEDIA_COMFYUI_ID, { workflowTemplateId: id })
  message.value = { kind: 'success', text: '已设为当前 ComfyUI 模板' }
}
</script>

<template>
  <section class="rounded-lg border border-edge bg-zinc-900/40 p-4" data-test="workflow-template-manager">
    <h2 class="text-sm font-semibold text-ink">ComfyUI 工作流模板</h2>
    <p class="mt-1 text-xs leading-relaxed text-ink-muted">
      粘贴 ComfyUI API 格式工作流 JSON，自动识别正向提示词 / 负向提示词 / seed 节点；保存后在 ComfyUI 媒体的「工作流模板」中选择使用。
    </p>

    <div class="mt-3 grid grid-cols-1 gap-3">
      <label class="block">
        <span class="mb-1 block text-xs text-ink-muted">模板名称</span>
        <Input
          v-model="name"
          placeholder="例如：Qwen 文生图"
          data-test="wf-name"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-ink-muted">工作流 JSON（API 格式）</span>
        <Textarea
          v-model="graphJson"
          :rows="6"
          placeholder='{"3": {"class_type": "KSampler", "inputs": {"seed": 42, "positive": ["6", 0], "negative": ["7", 0]}}, "6": {"class_type": "CLIPTextEncode", "inputs": {"text": ""}}}'
          class="font-mono text-xs"
          data-test="wf-graph"
        />
      </label>
      <div class="flex items-center gap-2">
        <Button variant="primary" size="sm" data-test="wf-import" @click="onImport">
          导入并识别节点
        </Button>
        <Button v-if="draft" size="sm" data-test="wf-save" @click="onSave">
          保存模板
        </Button>
      </div>
    </div>

    <div v-if="draft" class="mt-3 rounded-md bg-zinc-900/60 px-3 py-2 text-xs text-ink-muted" data-test="wf-detected">
      已识别：正向提示词节点
      <code class="text-ink">{{ draft.promptNodeId ?? '未检测到' }}</code>
      ，负向提示词
      <code class="text-ink">{{ draft.negativeNodeId ?? '—' }}</code>
      ，seed
      <code class="text-ink">{{ draft.seedNodeId ?? '—' }}</code>
    </div>

    <p
      v-if="message"
      class="mt-3 text-xs"
      :class="message.kind === 'error' ? 'text-red-400' : 'text-emerald-400'"
      data-test="wf-message"
    >
      {{ message.text }}
    </p>

    <div v-if="templates.length > 0" class="mt-4">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">已保存模板</h3>
      <ul class="mt-2 flex flex-col gap-2">
        <li
          v-for="t in templates"
          :key="t.id"
          class="flex items-center justify-between gap-3 rounded-md border border-edge bg-zinc-900/60 px-3 py-2"
          data-test="wf-template-item"
        >
          <div class="min-w-0">
            <span class="block truncate text-sm font-medium text-ink">{{ t.name }}</span>
            <span class="block truncate text-xs text-ink-muted">
              prompt={{ t.promptNodeId ?? '—' }}
              negative={{ t.negativeNodeId ?? '—' }}
              seed={{ t.seedNodeId ?? '—' }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button size="sm" data-test="wf-use" @click="onUse(t.id)">设为当前</Button>
            <Button size="sm" variant="ghost" data-test="wf-delete" @click="onDelete(t.id)">删除</Button>
          </div>
        </li>
      </ul>
    </div>
    <p v-else class="mt-4 text-xs text-ink-muted" data-test="wf-empty">
      暂无已保存的模板。
    </p>
  </section>
</template>
