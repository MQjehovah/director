import { newId } from '../../core/utils/id'

export interface WorkflowTemplate {
  id: string
  name: string
  graphJson: string
  promptNodeId?: string
  negativeNodeId?: string
  seedNodeId?: string
  createdAt?: string
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
      Object.keys(graph).find((id) => typeof graph[id].inputs.prompt === 'string')
  }

  if (negativeNodeId === undefined) {
    // 自定义/子图节点（如 MiniMax 系列）常用 negative_prompt 文本输入
    negativeNodeId = Object.keys(graph).find(
      (id) => typeof graph[id].inputs.negative_prompt === 'string',
    )
  }

  return { promptNodeId, negativeNodeId, seedNodeId }
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
): ImportWorkflowResult {
  const { promptNodeId, negativeNodeId, seedNodeId } = detectNodes(graph)
  return {
    id: newId('workflow'),
    name,
    graphJson: JSON.stringify(graph),
    promptNodeId,
    negativeNodeId,
    seedNodeId,
    createdAt: new Date().toISOString(),
  }
}

export function importWorkflowGraph(graphJson: string, name: string): ImportWorkflowResult {
  const { graph, error } = parseGraph(graphJson)
  if (!graph) return { error: error as string }
  return importWorkflowObject(name, graph)
}
