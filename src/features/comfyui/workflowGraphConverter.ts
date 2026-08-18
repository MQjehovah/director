/**
 * ComfyUI 工作流 JSON 转换：
 * - UI/前端格式（nodes/links/widgets_values）→ API/执行格式（节点 id → {class_type, inputs}）。
 * - 若输入本身已是 API 格式则原样通过。
 *
 * 转换参考 ComfyUI 前端 graphToPrompt 的序列化约定：
 * - node.inputs 中带 link 的条目 → 解析为 [originNodeId, originSlot]；
 * - 其余参数值来自 widgets_values，按节点定义（/object_info）中的输入顺序映射；
 * - control_after_generate 与 forceInput 的占位值不写入 API；
 * - PrimitiveNode / Reroute 为虚拟节点，不进入 API（PrimitiveNode 的值内联到目标输入）。
 */

export interface WorkflowNodeInputEntry {
  name?: string
  type?: string
  link?: number | null
  widget?: { name?: string } | null
  label?: string
}

export interface WorkflowUiNode {
  id: number | string
  type?: string
  mode?: number
  inputs?: WorkflowNodeInputEntry[]
  widgets_values?: unknown[]
  properties?: Record<string, unknown>
}

export type WorkflowLink = [
  number,
  number | string,
  number,
  number | string,
  number,
  string?,
]

export interface WorkflowUiGraph {
  nodes?: WorkflowUiNode[]
  links?: WorkflowLink[]
  version?: number
}

export interface ObjectInfoInputSpec {
  name: string
  spec: unknown
}

export interface ObjectInfoNodeDef {
  input?: {
    required?: Record<string, unknown>
    optional?: Record<string, unknown>
  }
  inputs?: {
    required?: Record<string, unknown>
    optional?: Record<string, unknown>
  }
}

export type ApiWorkflowGraph = Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>

export interface ConvertWorkflowResult {
  ok: boolean
  graph?: ApiWorkflowGraph
  error?: string
  warnings: string[]
}

/** 常见“值类型”输入（以 widget 形式出现在节点上）；其余大写类型视为连线类型 */
const WIDGET_TYPES = new Set([
  'STRING',
  'INT',
  'FLOAT',
  'BOOLEAN',
  'COMBO',
  'MARKDOWN',
  'IMAGEUPLOAD',
  'AUDIOUPLOAD',
  'VIDEOFILE',
  'VIDEOUPLOAD',
  'CURVE',
  'COLOR',
  'RANGE',
  'BOUNDING_BOX',
  'GALLERIA',
  'COMPOSITOR',
  'TEXTAREA',
  'PAINTER',
  'CHART',
  'BOUNDING_BOXES',
  'IMAGECOMPARE',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function specType(spec: unknown): string | undefined {
  if (Array.isArray(spec)) {
    const first = spec[0]
    return typeof first === 'string' ? first : undefined
  }
  if (isRecord(spec) && typeof spec.type === 'string') return spec.type
  if (typeof spec === 'string') return spec
  return undefined
}

function specConfig(spec: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(spec) && isRecord(spec[1])) return spec[1] as Record<string, unknown>
  if (isRecord(spec)) {
    const { type: _type, ...rest } = spec
    return rest
  }
  return undefined
}

/** 是否按 widget 呈现：值类型且未被 forceInput 转为输入槽 */
function isWidgetSpec(spec: unknown): boolean {
  const config = specConfig(spec)
  if (config && config.forceInput === true) return false
  const type = specType(spec)
  if (!type) return false
  return WIDGET_TYPES.has(type)
}

function hasControlAfterGenerate(spec: unknown): boolean {
  const config = specConfig(spec)
  return !!config && Object.prototype.hasOwnProperty.call(config, 'control_after_generate')
}

function isForceInput(spec: unknown): boolean {
  const config = specConfig(spec)
  return config?.forceInput === true
}

function orderedInputSpecs(def: ObjectInfoNodeDef | undefined): ObjectInfoInputSpec[] {
  if (!def) return []
  const input = def.input ?? def.inputs
  if (!input) return []
  const required = input.required ?? {}
  const optional = input.optional ?? {}
  const out: ObjectInfoInputSpec[] = []
  for (const [name, spec] of Object.entries(required)) out.push({ name, spec })
  for (const [name, spec] of Object.entries(optional)) out.push({ name, spec })
  return out
}

function wrapValue(value: unknown): unknown {
  return Array.isArray(value) ? { __value__: value } : value
}

function isPrimitiveNode(node: WorkflowUiNode | undefined): boolean {
  return node?.type === 'PrimitiveNode'
}

function isRerouteNode(node: WorkflowUiNode | undefined): boolean {
  return node?.type === 'Reroute'
}

function isExcludedMode(mode: number | undefined): boolean {
  // 2 = NEVER（静音/禁用），4 = BYPASS（旁路）
  return mode === 2 || mode === 4
}

function isVirtualType(type: string | undefined): boolean {
  return (
    type === 'Reroute' ||
    type === 'PrimitiveNode' ||
    type === 'GroupNode' ||
    type === 'Note' ||
    (type?.startsWith('GroupNode') ?? false)
  )
}

/** 判定输入 JSON 是否已是 API 格式（无 nodes 数组、各节点含 class_type） */
function looksLikeApiGraph(parsed: unknown): parsed is ApiWorkflowGraph {
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) return false
  if ('nodes' in parsed || 'links' in parsed) return false
  return Object.values(parsed).every(
    (v) =>
      isRecord(v) &&
      typeof v.class_type === 'string' &&
      isRecord(v.inputs),
  )
}

export interface ConvertOptions {
  objectInfo?: Record<string, ObjectInfoNodeDef>
}

export function convertWorkflowJsonToApiGraph(
  workflowJson: string | unknown,
  options: ConvertOptions = {},
): ConvertWorkflowResult {
  let parsed: unknown
  if (typeof workflowJson === 'string') {
    try {
      parsed = JSON.parse(workflowJson)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `工作流 JSON 解析失败：${reason}`, warnings: [] }
    }
  } else {
    parsed = workflowJson
  }

  if (looksLikeApiGraph(parsed)) {
    return { ok: true, graph: parsed, warnings: [] }
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.nodes)) {
    return {
      ok: false,
      error: '无法识别工作流格式：缺少 nodes 数组，请确认是 ComfyUI 工作流 JSON 或 API 格式。',
      warnings: [],
    }
  }

  const ui = parsed as WorkflowUiGraph
  const warnings: string[] = []
  const nodesById = new Map<number | string, WorkflowUiNode>()
  for (const node of ui.nodes ?? []) {
    if (node && node.id !== undefined) nodesById.set(node.id, node)
  }

  const links = new Map<number, WorkflowLink>()
  for (const link of ui.links ?? []) {
    if (Array.isArray(link) && link.length >= 5) links.set(link[0], link)
  }

  const excludedIds = new Set<number | string>()
  for (const node of ui.nodes ?? []) {
    if (node && isExcludedMode(node.mode)) {
      excludedIds.add(node.id)
    }
  }

  /** 沿 Reroute / PrimitiveNode 解析链路起点 */
  function resolveOrigin(
    originId: number | string,
    originSlot: number,
  ): { value: unknown } | { ref: [string, number] } | undefined {
    let currentId: number | string = originId
    let slot = originSlot
    let depth = 0
    while (depth < 32) {
      depth += 1
      if (excludedIds.has(currentId)) return undefined
      const node = nodesById.get(currentId)
      if (!node) return undefined
      if (isPrimitiveNode(node)) {
        return { value: wrapValue(node.widgets_values?.[0]) }
      }
      if (isRerouteNode(node)) {
        const entry = node.inputs?.find((i) => i.link != null)
        const link = entry?.link != null ? links.get(entry.link) : undefined
        if (!link) return undefined
        currentId = link[1]
        slot = link[2]
        continue
      }
      if (isVirtualType(node.type)) return undefined
      return { ref: [String(currentId), slot] }
    }
    return undefined
  }

  const graph: ApiWorkflowGraph = {}

  for (const node of ui.nodes ?? []) {
    if (!node || node.id === undefined) continue
    const type = node.type
    if (!type || isVirtualType(type) || isExcludedMode(node.mode)) continue

    const inputs: Record<string, unknown> = {}
    const linkedInputNames = new Set<string>()
    const declaredWidgetNames: string[] = []

    // 1) 连线输入
    for (const entry of node.inputs ?? []) {
      const name = entry.name
      if (!name) continue
      if (entry.link != null) {
        linkedInputNames.add(name)
        const link = links.get(entry.link)
        if (link) {
          const resolved = resolveOrigin(link[1], link[2])
          if (resolved && 'ref' in resolved) {
            inputs[name] = resolved.ref
          } else if (resolved && 'value' in resolved) {
            inputs[name] = resolved.value
          }
        }
      } else if (entry.widget?.name) {
        declaredWidgetNames.push(entry.widget.name)
      }
    }

    // 2) widgets_values → 命名输入
    const widgetValues = [...(node.widgets_values ?? [])]
    const def = options.objectInfo?.[type]

    interface ConsumptionUnit {
      kind: 'value' | 'skip'
      name?: string
      forceInputDummy?: boolean
    }

    let units: ConsumptionUnit[] = []
    if (def) {
      for (const { name, spec } of orderedInputSpecs(def)) {
        if (linkedInputNames.has(name)) continue
        if (isWidgetSpec(spec)) {
          units.push({ kind: 'value', name })
          if (hasControlAfterGenerate(spec)) units.push({ kind: 'skip' })
        } else if (isForceInput(spec)) {
          units.push({ kind: 'skip', forceInputDummy: true })
        }
      }
    } else if (declaredWidgetNames.length > 0) {
      // 新格式：node.inputs 自带 widget 名称（未连线部分）
      units = declaredWidgetNames
        .filter((n) => !linkedInputNames.has(n))
        .map((name) => ({ kind: 'value', name }))
    } else {
      // 兜底：内置常见核心节点映射
      units = fallbackUnits(type).filter((u) => u.kind !== 'value' || !linkedInputNames.has(u.name!))
    }

    const forceInputDummyCount = units.filter((u) => u.forceInputDummy).length
    const unitsWithoutDummies = units.filter((u) => !u.forceInputDummy)
    // 新版序列化不再为 forceInput 保留占位值；按长度匹配选择消费方式
    const consumeAll =
      widgetValues.length === units.length ||
      (forceInputDummyCount > 0 &&
        widgetValues.length === unitsWithoutDummies.length &&
        widgetValues.length < units.length)
    const consumption = consumeAll ? units : unitsWithoutDummies

    let valueIndex = 0
    for (const unit of consumption) {
      const value = widgetValues[valueIndex]
      if (unit.kind === 'value' && unit.name && value !== undefined) {
        inputs[unit.name] = wrapValue(value)
      }
      valueIndex += 1
    }

    if (valueIndex < widgetValues.length) {
      warnings.push(
        `节点 ${node.id}（${type}）有 ${widgetValues.length - valueIndex} 个参数值未能映射，请导入后检查。`,
      )
    }

    graph[String(node.id)] = { class_type: type, inputs }
  }

  // 清理指向被排除节点的引用
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string' &&
        !(value[0] in graph)
      ) {
        delete node.inputs[key]
      }
    }
  }

  return { ok: true, graph, warnings }
}

/** 无 /object_info 时的兜底映射：覆盖导演台常用核心节点 */
function fallbackUnits(type: string): Array<{ kind: 'value' | 'skip'; name?: string }> {
  const toUnits = (
    names: string[],
    controlAfter = new Set<string>(),
  ): Array<{ kind: 'value' | 'skip'; name?: string }> => {
    const out: Array<{ kind: 'value' | 'skip'; name?: string }> = []
    for (const name of names) {
      out.push({ kind: 'value', name })
      if (controlAfter.has(name)) out.push({ kind: 'skip' })
    }
    return out
  }
  switch (type) {
    case 'KSampler':
      return toUnits(
        ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
        new Set(['seed']),
      )
    case 'KSamplerAdvanced':
      return toUnits(
        [
          'seed',
          'steps',
          'cfg',
          'sampler_name',
          'scheduler',
          'start_at_step',
          'end_at_step',
          'add_noise',
          'return_with_leftover_noise',
        ],
        new Set(['seed']),
      )
    case 'CLIPTextEncode':
      return toUnits(['text'])
    case 'CheckpointLoaderSimple':
      return toUnits(['ckpt_name'])
    case 'UNETLoader':
      return toUnits(['unet_name', 'weight_dtype'])
    case 'CLIPLoader':
      return toUnits(['clip_name', 'type', 'device'])
    case 'VAELoader':
      return toUnits(['vae_name'])
    case 'EmptyLatentImage':
      return toUnits(['width', 'height', 'batch_size'])
    case 'EmptySD3LatentImage':
      return toUnits(['width', 'height', 'batch_size'])
    case 'SaveImage':
      return toUnits(['filename_prefix'])
    case 'SaveAnimatedWEBP':
      return toUnits(['filename_prefix', 'fps', 'lossless', 'quality', 'method'])
    case 'LoadImage':
      return toUnits(['image', 'upload'])
    case 'LoadVideo':
      return toUnits(['video', 'force_rate', 'force_size', 'custom_width', 'custom_height'])
    case 'PrimitiveFloat':
      return toUnits(['value'])
    case 'PrimitiveInt':
      return toUnits(['value'])
    case 'PrimitiveString':
      return toUnits(['value'])
    case 'ComfyMathExpression':
      return toUnits(['expression'])
    case 'ResolutionSelector':
      return toUnits(['aspect_ratio', 'megapixels', 'multiple'])
    case 'BasicScheduler':
      return toUnits(['scheduler', 'steps', 'denoise'])
    case 'BasicGuider':
      return toUnits([])
    case 'RandomNoise':
      return toUnits(['noise_seed'], new Set(['noise_seed']))
    case 'SamplerCustomAdvanced':
      return toUnits([])
    case 'KSamplerSelect':
      return toUnits(['sampler_name'])
    case 'CreateVideo':
      return toUnits(['fps', 'bit_depth'])
    case 'SaveVideo':
      return toUnits([
        'filename_prefix',
        'format',
        'codec',
        'pix_fmt',
        'quality',
        'audio_codec',
      ])
    case 'MiniMaxH3ImageToVideo':
      return toUnits(['prompt', 'width', 'height', 'length'])
    case 'MiniMaxH3TextToVideo':
      return toUnits(['prompt', 'width', 'height', 'length'])
    default:
      return toUnits([])
  }
}
