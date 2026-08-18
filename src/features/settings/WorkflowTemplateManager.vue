<script setup lang="ts">
import { ref } from 'vue'
import { Button, Dialog, Input, Select, Switch, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import {
  deleteWorkflowTemplate,
  importWorkflowGraph,
  importWorkflowObject,
  listWorkflowTemplates,
  saveWorkflowTemplate,
} from '../comfyui/workflowStore'
import type { WorkflowTemplate } from '../comfyui/workflowStore'
import type { WorkflowParameter } from '../comfyui/workflowStore'
import { loadProviderConfig } from './httpBackendConfig'
import {
  MEDIA_COMFYUI_ID,
  isStaleBrokenTemplate,
  repairLegacyMisalignedGraph,
} from '../../plugins/providers/media-comfyui'
import {
  convertWorkflowJsonToApiGraph,
  detectParameterLabels,
} from '../comfyui/workflowGraphConverter'
import type { ApiWorkflowGraph, ObjectInfoNodeDef } from '../comfyui/workflowGraphConverter'
import {
  listComfyUIWorkflows,
  fetchComfyUIWorkflowContent,
  fetchComfyUIObjectInfo,
} from '../comfyui/comfyuiWorkflowFetcher'
import type { RemoteWorkflowItem } from '../comfyui/comfyuiWorkflowFetcher'

const emit = defineEmits<{ (e: 'changed'): void }>()

const name = ref('')
const graphJson = ref('')
const draft = ref<WorkflowTemplate | undefined>(undefined)
const draftWarnings = ref<string[]>([])
const message = ref<{ kind: 'error' | 'success' | 'info'; text: string } | undefined>(undefined)
const templates = ref<WorkflowTemplate[]>(listWorkflowTemplates())
const paramEditor = ref<
  { template: WorkflowTemplate; draft: Record<string, unknown> } | undefined
>(undefined)

const placeholderOptions: SelectOption[] = [
  { value: '', label: '占位符' },
  { value: '${duration}', label: '分镜时长 ${duration}' },
  { value: '${prompt}', label: '提示词 ${prompt}' },
  { value: '${negative_prompt}', label: '负面提示词 ${negative_prompt}' },
  { value: '${seed}', label: '随机种子 ${seed}' },
]

// 从 ComfyUI 拉取（默认折叠，保持面板紧凑）
const remoteOpen = ref(false)
const remoteBaseUrl = ref('')
const remoteBusy = ref(false)
const remoteItems = ref<RemoteWorkflowItem[]>([])
const remoteMode = ref<'api' | 'userdata' | 'none'>('none')

function refresh(): void {
  templates.value = listWorkflowTemplates()
}

/** 模板列表变化后通知父级（如 Provider 配置中的模板下拉框）刷新 */
function refreshAndNotify(): void {
  refresh()
  emit('changed')
}

/** 旧版本模板（导入时参数错位）：建议删除后重新导入 */
function isStaleTemplate(t: WorkflowTemplate): boolean {
  try {
    return isStaleBrokenTemplate(JSON.parse(t.graphJson))
  } catch {
    return false
  }
}

function configBaseUrl(): string {
  const value = loadProviderConfig(MEDIA_COMFYUI_ID)?.baseUrl
  return typeof value === 'string' ? value : ''
}

/** 尝试把 JSON 文本识别为工作流：优先 API 格式，其次 UI 格式（自动转换） */
function importJsonText(
  text: string,
  fallbackName: string,
  objectInfo?: Record<string, ObjectInfoNodeDef>,
): { result?: WorkflowTemplate; error?: string; warnings: string[] } {
  const targetName = name.value.trim() || fallbackName
  const repairWarning =
    '检测到旧版展开图（CLIPLoader 参数错位），已自动修复并保存；建议用 ComfyUI 导出的原始工作流 JSON（nodes/links 格式）重新导入以获得完整数据。'
  const apiResult = importWorkflowGraph(text, targetName)
  if (!('error' in apiResult)) {
    let parsedResult: ApiWorkflowGraph | undefined
    try {
      parsedResult = JSON.parse(apiResult.graphJson) as ApiWorkflowGraph
    } catch {
      parsedResult = undefined
    }
    if (!parsedResult) return { result: apiResult, warnings: [] }
    const repaired = repairLegacyMisalignedGraph(parsedResult)
    const result = importWorkflowObject(targetName, parsedResult, undefined, objectInfo)
    if ('error' in result) return { error: result.error, warnings: [] }
    return { result, warnings: repaired ? [repairWarning] : [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: apiResult.error, warnings: [] }
  }
  const converted = convertWorkflowJsonToApiGraph(parsed, { objectInfo })
  if (!converted.ok || !converted.graph) {
    return { error: converted.error ?? apiResult.error, warnings: converted.warnings }
  }
  const repaired = repairLegacyMisalignedGraph(converted.graph)
  const warnings = [...converted.warnings]
  if (repaired) warnings.push(repairWarning)
  const result = importWorkflowObject(
    targetName,
    converted.graph as ApiWorkflowGraph,
    detectParameterLabels(parsed),
    objectInfo,
  )
  if ('error' in result) {
    return { error: result.error, warnings }
  }
  return { result, warnings }
}

function onImport(): void {
  message.value = undefined
  draft.value = undefined
  draftWarnings.value = []
  const { result, error, warnings } = importJsonText(graphJson.value, '未命名模板')
  if (!result || error) {
    message.value = { kind: 'error', text: error ?? '导入失败' }
    return
  }
  draft.value = result
  draftWarnings.value = warnings
}

async function onImportFile(e: Event): Promise<void> {
  message.value = undefined
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  const fallbackName = file.name.replace(/\.json$/i, '') || '未命名模板'
  draft.value = undefined
  draftWarnings.value = []
  const { result, error, warnings } = importJsonText(text, fallbackName)
  if (!result || error) {
    message.value = { kind: 'error', text: error ?? '导入失败' }
    return
  }
  name.value = name.value.trim() || fallbackName
  graphJson.value = result.graphJson
  draft.value = result
  draftWarnings.value = warnings
  message.value = { kind: 'success', text: '已从文件导入，检查识别结果后保存。' }
}

async function onFetchRemote(): Promise<void> {
  message.value = undefined
  const baseUrl = remoteBaseUrl.value.trim() || configBaseUrl()
  if (!baseUrl) {
    message.value = { kind: 'error', text: '请先填写 ComfyUI 地址（或在 Provider 配置中填写 Base URL）。' }
    return
  }
  remoteBaseUrl.value = baseUrl
  remoteBusy.value = true
  try {
    const apiKey = loadProviderConfig(MEDIA_COMFYUI_ID)?.apiKey
    const result = await listComfyUIWorkflows(baseUrl, typeof apiKey === 'string' ? apiKey : undefined)
    remoteMode.value = result.mode
    if (!result.ok) {
      message.value = { kind: 'error', text: result.error ?? '拉取失败' }
      remoteItems.value = []
      return
    }
    remoteItems.value = result.items
    message.value =
      result.items.length > 0
        ? { kind: 'info', text: `已从 ComfyUI 获取 ${result.items.length} 个工作流。` }
        : { kind: 'info', text: 'ComfyUI 中没有找到已保存的工作流。' }
  } catch (err) {
    message.value = { kind: 'error', text: err instanceof Error ? err.message : String(err) }
  } finally {
    remoteBusy.value = false
  }
}

async function onImportRemote(item: RemoteWorkflowItem): Promise<void> {
  message.value = undefined
  remoteBusy.value = true
  try {
    const apiKey = loadProviderConfig(MEDIA_COMFYUI_ID)?.apiKey
    const key = typeof apiKey === 'string' ? apiKey : undefined
    const content = await fetchComfyUIWorkflowContent(
      remoteBaseUrl.value,
      item,
      key,
    )
    if (!content.ok || content.workflowJson === undefined) {
      message.value = { kind: 'error', text: content.error ?? '获取工作流内容失败' }
      return
    }
    // 用 /object_info 提升 widgets_values 映射准确度；失败时回退内置映射
    let objectInfo: Record<string, ObjectInfoNodeDef> | undefined
    try {
      objectInfo = await fetchComfyUIObjectInfo(remoteBaseUrl.value, key)
    } catch {
      objectInfo = undefined
    }
    draft.value = undefined
    draftWarnings.value = []
    const { result, error, warnings } = importJsonText(
      JSON.stringify(content.workflowJson),
      item.name,
      objectInfo,
    )
    if (!result || error) {
      message.value = { kind: 'error', text: error ?? '导入失败' }
      return
    }
    // 拉取导入直接保存，无需再经文本框草稿二次确认
    saveWorkflowTemplate({ ...result, name: name.value.trim() || result.name })
    name.value = ''
    graphJson.value = ''
    draft.value = undefined
    draftWarnings.value = []
    refreshAndNotify()
    message.value = {
      kind: 'success',
      text:
        (warnings.length > 0 ? '已从 ComfyUI 导入并保存（部分节点参数需人工检查）；' : '已从 ComfyUI 导入并保存；') +
        '请在「ComfyUI 媒体」Provider 配置中按生成类型选择该模板。',
    }
  } catch (err) {
    message.value = { kind: 'error', text: err instanceof Error ? err.message : String(err) }
  } finally {
    remoteBusy.value = false
  }
}

function onSave(): void {
  if (!draft.value) return
  saveWorkflowTemplate({ ...draft.value, name: name.value.trim() || draft.value.name })
  draft.value = undefined
  graphJson.value = ''
  name.value = ''
  message.value = { kind: 'success', text: '模板已保存' }
  refreshAndNotify()
}

function onDelete(id: string): void {
  deleteWorkflowTemplate(id)
  refreshAndNotify()
}

function paramKey(p: WorkflowParameter): string {
  return `${p.nodeId}:${p.input}`
}

function paramDraftValue(p: WorkflowParameter): unknown {
  if (!paramEditor.value) return p.value
  const key = paramKey(p)
  return key in paramEditor.value.draft ? paramEditor.value.draft[key] : p.value
}

function paramPlaceholderValue(p: WorkflowParameter): string {
  const v = paramDraftValue(p)
  return typeof v === 'string' && placeholderOptions.some((o) => o.value === v) ? v : ''
}

function setParamDraft(p: WorkflowParameter, value: unknown): void {
  if (!paramEditor.value) return
  const draft = { ...paramEditor.value.draft }
  if (value === undefined || value === null || value === '') {
    delete draft[paramKey(p)]
  } else {
    draft[paramKey(p)] = value
  }
  paramEditor.value = { ...paramEditor.value, draft }
}

function openParamEditor(t: WorkflowTemplate): void {
  paramEditor.value = { template: t, draft: { ...(t.parameterOverrides ?? {}) } }
}

function closeParamEditor(): void {
  paramEditor.value = undefined
}

function saveParamEditor(): void {
  const editor = paramEditor.value
  if (!editor) return
  saveWorkflowTemplate({ ...editor.template, parameterOverrides: { ...editor.draft } })
  paramEditor.value = undefined
  refreshAndNotify()
  message.value = { kind: 'success', text: '参数已保存' }
}
</script>

<template>
  <section class="rounded-lg border border-edge bg-zinc-900/40 p-3" data-test="workflow-template-manager">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="text-sm font-semibold text-ink">ComfyUI 工作流模板</h3>
      <span class="text-[10px] text-ink-muted">粘贴 / 文件 / 拉取三种方式</span>
    </div>

    <div class="mt-2.5 grid grid-cols-1 gap-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-ink-muted">模板名称</span>
        <Input
          v-model="name"
          class="!h-8 !px-2.5 !text-xs"
          placeholder="例如：Qwen 文生图"
          data-test="wf-name"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-[11px] text-ink-muted">
          工作流 JSON（API 格式或前端 nodes 格式）
        </span>
        <Textarea
          v-model="graphJson"
          :rows="4"
          placeholder='{"3": {"class_type": "KSampler", "inputs": {"seed": 42, "positive": ["6", 0], "negative": ["7", 0]}}, "6": {"class_type": "CLIPTextEncode", "inputs": {"text": ""}}}'
          class="!text-xs"
          data-test="wf-graph"
        />
      </label>
      <div class="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="sm" data-test="wf-import" @click="onImport">
          导入并识别节点
        </Button>
        <label
          class="inline-flex cursor-pointer items-center rounded-md border border-edge px-2.5 py-1 text-xs text-ink transition-colors hover:bg-zinc-800"
          data-test="wf-file-import"
        >
          从文件导入
          <input
            type="file"
            accept=".json,application/json"
            class="hidden"
            data-test="wf-file-input"
            @change="onImportFile"
          />
        </label>
        <Button v-if="draft" size="sm" data-test="wf-save" @click="onSave">
          保存模板
        </Button>
      </div>
    </div>

    <div v-if="draft" class="mt-2 rounded-md bg-zinc-900/60 px-2.5 py-1.5 text-xs text-ink-muted" data-test="wf-detected">
      识别：prompt
      <code class="text-ink">{{ draft.promptNodeId ?? '未检测到' }}</code>
      · negative
      <code class="text-ink">{{ draft.negativeNodeId ?? '—' }}</code>
      · seed
      <code class="text-ink">{{ draft.seedNodeId ?? '—' }}</code>
    </div>
    <ul v-if="draftWarnings.length > 0" class="mt-1.5 flex flex-col gap-1 text-xs text-amber-300" data-test="wf-warnings">
      <li v-for="(w, i) in draftWarnings" :key="i">{{ w }}</li>
    </ul>

    <p
      v-if="message"
      class="mt-2 text-xs"
      :class="message.kind === 'error' ? 'text-red-400' : message.kind === 'success' ? 'text-emerald-400' : 'text-sky-300'"
      data-test="wf-message"
    >
      {{ message.text }}
    </p>

    <div class="mt-3 rounded-md border border-edge bg-zinc-900/60 px-2.5 py-1.5" data-test="wf-remote">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 text-left text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        data-test="wf-remote-toggle"
        @click="remoteOpen = !remoteOpen"
      >
        <span class="text-[10px] transition-transform" :class="remoteOpen ? 'rotate-90' : ''">▸</span>
        从 ComfyUI 拉取
        <span v-if="!remoteOpen && (remoteBaseUrl || configBaseUrl())" class="truncate text-[10px] text-ink-muted/70">
          {{ remoteBaseUrl || configBaseUrl() }}
        </span>
      </button>

      <div v-if="remoteOpen" class="mt-2 flex flex-col gap-2">
        <p class="text-[10px] leading-relaxed text-ink-muted">
          地址默认取 Provider 的 Base URL，拉取该实例已保存的工作流并转换为模板。
        </p>
        <div class="flex gap-1.5">
          <Input
            v-model="remoteBaseUrl"
            class="!h-8 !px-2.5 !text-xs"
            :placeholder="configBaseUrl() || 'http://127.0.0.1:8188'"
            data-test="wf-remote-url"
          />
          <Button
            size="sm"
            class="shrink-0"
            :disabled="remoteBusy"
            data-test="wf-remote-fetch"
            @click="onFetchRemote"
          >
            {{ remoteBusy ? '拉取中…' : '拉取' }}
          </Button>
        </div>
        <p v-if="remoteMode !== 'none'" class="text-[10px] text-ink-muted">
          数据来源：{{ remoteMode === 'api' ? '新版工作流 API' : 'userdata 文件目录' }}
        </p>
        <ul v-if="remoteItems.length > 0" class="flex flex-col gap-1">
          <li
            v-for="item in remoteItems"
            :key="item.id"
            class="flex items-center justify-between gap-2 rounded-md bg-zinc-900/40 px-2 py-1"
            data-test="wf-remote-item"
          >
            <span class="min-w-0 truncate text-xs text-ink">{{ item.name }}</span>
            <Button
              size="sm"
              variant="outline"
              class="shrink-0"
              :disabled="remoteBusy"
              data-test="wf-remote-import"
              @click="onImportRemote(item)"
            >
              导入
            </Button>
          </li>
        </ul>
        <p v-else-if="remoteMode === 'userdata'" class="text-[10px] text-ink-muted">
          旧版 ComfyUI 通过 userdata 目录读取（工作流需保存在默认工作流目录）。
        </p>
      </div>
    </div>

    <div v-if="templates.length > 0" class="mt-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">已保存模板</h3>
      <ul class="mt-1.5 flex flex-col gap-1.5">
        <li
          v-for="t in templates"
          :key="t.id"
          class="flex items-center justify-between gap-3 rounded-md border border-edge bg-zinc-900/60 px-2.5 py-1.5"
          data-test="wf-template-item"
        >
          <div class="min-w-0">
            <span class="block truncate text-xs font-medium text-ink">{{ t.name }}</span>
            <span
              v-if="isStaleTemplate(t)"
              class="block text-[10px] text-amber-300"
              data-test="wf-stale-badge"
            >
              旧版本（参数错位），请删除后重新导入
            </span>
            <span class="block truncate text-[10px] text-ink-muted">
              prompt={{ t.promptNodeId ?? '—' }}
              negative={{ t.negativeNodeId ?? '—' }}
              seed={{ t.seedNodeId ?? '—' }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" data-test="wf-params" @click="openParamEditor(t)">
              参数编辑
            </Button>
            <Button size="sm" variant="ghost" data-test="wf-delete" @click="onDelete(t.id)">删除</Button>
          </div>
        </li>
      </ul>
    </div>
    <p v-else class="mt-3 text-xs text-ink-muted" data-test="wf-empty">
      暂无已保存的模板。
    </p>

    <Dialog :open="!!paramEditor" title="工作流参数" @close="closeParamEditor">
      <template v-if="paramEditor">
        <p class="mb-3 text-xs text-ink-muted">
          {{ paramEditor.template.name }}：参数会在每次生成时覆盖模板默认值。
        </p>
        <p
          v-if="(paramEditor.template.parameters ?? []).length === 0"
          class="text-xs text-ink-muted"
          data-test="param-empty"
        >
          该模板未识别到可编辑参数。
        </p>
        <div
          v-for="p in (paramEditor.template.parameters ?? []).filter(
            (x) => x.type !== 'image' && x.type !== 'video' && x.type !== 'audio',
          )"
          :key="paramKey(p)"
          class="flex items-center justify-between gap-3 border-b border-edge py-2"
          data-test="param-row"
        >
          <span class="min-w-0 truncate text-xs text-ink">{{ p.label }}</span>
          <span class="flex shrink-0 items-center gap-1.5">
            <Switch
              v-if="p.type === 'boolean'"
              :model-value="paramDraftValue(p) === true"
              :data-test="`param-${paramKey(p)}`"
              @update:model-value="setParamDraft(p, $event)"
            />
            <Input
              v-else-if="p.type === 'number'"
              class="!h-8 w-24"
              type="number"
              :model-value="String(paramDraftValue(p) ?? '')"
              :data-test="`param-${paramKey(p)}`"
              @update:model-value="setParamDraft(p, $event === '' ? undefined : Number($event))"
            />
            <Input
              v-else
              class="!h-8 w-40"
              :model-value="String(paramDraftValue(p) ?? '')"
              :data-test="`param-${paramKey(p)}`"
              @update:model-value="setParamDraft(p, $event)"
            />
            <Select
              class="!h-8 w-28"
              :model-value="paramPlaceholderValue(p)"
              :options="placeholderOptions"
              :data-test="`param-ph-${paramKey(p)}`"
              @update:model-value="setParamDraft(p, $event || undefined)"
            />
            <Button
              size="sm"
              variant="ghost"
              class="!px-1.5 !text-[10px]"
              :data-test="`param-reset-${paramKey(p)}`"
              @click="setParamDraft(p, undefined)"
            >
              重置
            </Button>
          </span>
        </div>
      </template>
      <template #footer>
        <Button size="sm" variant="ghost" data-test="param-cancel" @click="closeParamEditor">
          取消
        </Button>
        <Button size="sm" variant="primary" data-test="param-save" @click="saveParamEditor">
          保存
        </Button>
      </template>
    </Dialog>
  </section>
</template>
