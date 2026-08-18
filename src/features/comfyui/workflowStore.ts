import { newId } from '../../core/utils/id'

export interface WorkflowTemplate {
  id: string
  name: string
  graphJson: string
  promptNodeId?: string
  negativeNodeId?: string
  seedNodeId?: string
  /** 工作流标量参数（如 enable_turbo_mode / 模型名 / 采样器等），可在 Provider 配置中覆盖 */
  parameters?: WorkflowParameter[]
  /** 该模板的参数覆盖（key：`${节点ID}:${输入名}`），每次生成时写入工作流 */
  parameterOverrides?: Record<string, unknown>
  createdAt?: string
}

export interface WorkflowParameter {
  nodeId: string
  input: string
  label: string
  type: 'string' | 'number' | 'boolean'
  value: string | number | boolean
}

export type ImportWorkflowResult = WorkflowTemplate | { error: string }

const STORAGE_KEY = 'ai-director:comfyui-workflows'

interface GraphNode {
  class_type: string
  inputs: Record<string, unknown>
}

type WorkflowGraph = Record<string, GraphNode>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseGraph(graphJson: string): { graph?: WorkflowGraph; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(graphJson)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { error: `工作流 JSON 解析失败：${reason}` }
  }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    return { error: '工作流 JSON 需为非空对象（节点 ID → 节点），请检查模板格式。' }
  }
  for (const [id, node] of Object.entries(parsed)) {
    if (!isRecord(node) || typeof node.class_type !== 'string') {
      return { error: `节点 ${id} 缺少 class_type，请使用 ComfyUI API 格式的工作流。` }
    }
    if (!isRecord(node.inputs)) {
      return { error: `节点 ${id} 缺少 inputs。` }
    }
  }
  return { graph: parsed as WorkflowGraph }
}

function classTypeOf(graph: WorkflowGraph, ref: unknown): string | undefined {
  if (!Array.isArray(ref) || typeof ref[0] !== 'string') return undefined
  return graph[ref[0]]?.class_type
}

function isClipTextEncode(classType: string | undefined): boolean {
  return classType !== undefined && classType.includes('CLIPTextEncode')
}

/** 输入是否为指向图中现有节点的引用（子图展开后 prompt/seed 常由内部 Primitive* 提供） */
function isRefInput(graph: WorkflowGraph, value: unknown): boolean {
  return (
    Array.isArray(value) &&
    typeof value[0] === 'string' &&
    graph[value[0]] !== undefined
  )
}

function hasStringOrRefInput(graph: WorkflowGraph, id: string, key: string): boolean {
  const value = graph[id]?.inputs[key]
  return typeof value === 'string' || isRefInput(graph, value)
}

function detectNodes(graph: WorkflowGraph): {
  promptNodeId?: string
  negativeNodeId?: string
  seedNodeId?: string
} {
  let promptNodeId: string | undefined
  let negativeNodeId: string | undefined
  let seedNodeId: string | undefined

  for (const [id, node] of Object.entries(graph)) {
    if (node.class_type === 'KSampler') {
      if (seedNodeId === undefined) seedNodeId = id
      if (promptNodeId === undefined && isClipTextEncode(classTypeOf(graph, node.inputs.positive))) {
        promptNodeId = (node.inputs.positive as string[])[0]
      }
      if (negativeNodeId === undefined && isClipTextEncode(classTypeOf(graph, node.inputs.negative))) {
        negativeNodeId = (node.inputs.negative as string[])[0]
      }
    }
    // seed 兜底：RandomNoise 等带 noise_seed 的节点
    if (seedNodeId === undefined && typeof node.inputs.noise_seed === 'number') {
      seedNodeId = id
    }
  }

  if (promptNodeId === undefined) {
    // 优先 CLIPTextEncode；否则找任意带字符串 prompt 输入的节点（MiniMaxH3ImageToVideo 等自定义节点）
    promptNodeId =
      Object.keys(graph).find((id) => isClipTextEncode(graph[id].class_type)) ??
      Object.keys(graph).find((id) => hasStringOrRefInput(graph, id, 'prompt'))
  }

  if (negativeNodeId === undefined) {
    // 自定义/子图节点（如 MiniMax 系列）常用 negative_prompt 文本输入
    negativeNodeId = Object.keys(graph).find(
      (id) => hasStringOrRefInput(graph, id, 'negative_prompt'),
    )
  }

  if (seedNodeId === undefined) {
    // 子图展开后 seed 可能是指向内部 Primitive 的引用
    seedNodeId =
      Object.keys(graph).find((id) => typeof graph[id].inputs.noise_seed === 'number') ??
      Object.keys(graph).find((id) => isRefInput(graph, graph[id].inputs.noise_seed)) ??
      Object.keys(graph).find((id) => typeof graph[id].inputs.seed === 'number') ??
      Object.keys(graph).find((id) => isRefInput(graph, graph[id].inputs.seed))
  }

  return { promptNodeId, negativeNodeId, seedNodeId }
}

/**
 * 收集工作流中的标量参数（字符串/数字/布尔输入），供 Provider 配置覆盖。
 * 排除每次生成动态注入的 prompt/text/negative_prompt/seed/noise_seed。
 */
const DYNAMIC_PARAM_KEYS = new Set(['prompt', 'text', 'negative_prompt', 'seed', 'noise_seed'])

function detectParameters(
  graph: WorkflowGraph,
  labels: Record<string, string> = {},
): WorkflowParameter[] {
  const out: WorkflowParameter[] = []
  for (const [nodeId, node] of Object.entries(graph)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      if (input === 'widgets_values' || DYNAMIC_PARAM_KEYS.has(input)) continue
      const scalar =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      if (!scalar) continue
      out.push({
        nodeId,
        input,
        label:
          labels[`${nodeId}:${input}`] ??
          `${node.class_type} · ${input}`,
        type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
        value,
      })
    }
  }
  return out
}

function readAll(): WorkflowTemplate[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is WorkflowTemplate =>
        isRecord(t) && typeof t.id === 'string' && typeof t.name === 'string',
    )
  } catch {
    return []
  }
}

function writeAll(templates: WorkflowTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch {
    // storage may be unavailable (privacy mode / quota); ignore silently
  }
}

export function listWorkflowTemplates(): WorkflowTemplate[] {
  return readAll()
}

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return readAll().find((t) => t.id === id)
}

export function saveWorkflowTemplate(tpl: WorkflowTemplate): void {
  const target: WorkflowTemplate = { ...tpl, id: tpl.id || newId('workflow') }
  const templates = readAll()
  const idx = templates.findIndex((t) => t.id === target.id)
  if (idx >= 0) templates[idx] = target
  else templates.push(target)
  writeAll(templates)
}

export function deleteWorkflowTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id))
}

/** 校验并识别 API 格式图（节点 id → {class_type, inputs}），供转换结果/文件导入复用 */
export function importWorkflowObject(
  name: string,
  graph: WorkflowGraph,
  parameterLabels?: Record<string, string>,
): ImportWorkflowResult {
  const { promptNodeId, negativeNodeId, seedNodeId } = detectNodes(graph)
  return {
    id: newId('workflow'),
    name,
    graphJson: JSON.stringify(graph),
    promptNodeId,
    negativeNodeId,
    seedNodeId,
    parameters: detectParameters(graph, parameterLabels),
    createdAt: new Date().toISOString(),
  }
}

export function importWorkflowGraph(graphJson: string, name: string): ImportWorkflowResult {
  const { graph, error } = parseGraph(graphJson)
  if (!graph) return { error: error as string }
  return importWorkflowObject(name, graph)
}
