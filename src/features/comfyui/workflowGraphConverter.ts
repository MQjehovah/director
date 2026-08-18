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

function specForInputName(
  def: ObjectInfoNodeDef | undefined,
  name: string,
): unknown {
  const input = def?.input ?? def?.inputs
  if (!input) return undefined
  return input.required?.[name] ?? input.optional?.[name]
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

/** 注释/便签节点：文本只用于展示，不进入执行参数（与 ComfyUI 导出行为一致） */
const NOTE_TYPES = new Set(['MarkdownNote', 'Comment'])

function isNoteType(type: string | undefined): boolean {
  return !!type && NOTE_TYPES.has(type)
}

/** 已知存在“前端附加参数”的核心节点：多余参数为 upload 占位、预览等 UI 状态，静默忽略 */
const SILENT_EXTRA_TYPES = new Set([
  'LoadImage',
  'LoadImageMask',
  'LoadImageOutput',
  'LoadVideo',
  'SaveImage',
  'SaveImageAdvanced',
  'SaveVideo',
  'PreviewImage',
])

function isSilentExtraFamily(type: string): boolean {
  return SILENT_EXTRA_TYPES.has(type)
}

function isLoadImageFamily(type: string): boolean {
  return type === 'LoadImage' || type === 'LoadImageMask' || type === 'LoadImageOutput'
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

    // 注释/便签节点：保留节点（与 ComfyUI API 导出一致），文本值不映射、不告警
    if (isNoteType(type)) {
      graph[String(node.id)] = { class_type: type, inputs: {} }
      continue
    }

    const inputs: Record<string, unknown> = {}
    const linkedInputNames = new Set<string>()
    const widgetEntries: WorkflowNodeInputEntry[] = []

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
      }
      // 新格式：widget 也会出现在 inputs 里（含已连线项），按出现顺序对应 widgets_values
      if (entry.widget?.name) widgetEntries.push(entry)
    }

    // 2) widgets_values → 命名输入
    const rawWidgets = node.widgets_values
    // 自定义序列化（如 VHS 系列）：widgets_values 直接是 { 参数名: 值 } 对象
    if (isRecord(rawWidgets)) {
      for (const [name, value] of Object.entries(rawWidgets)) {
        if (!linkedInputNames.has(name)) inputs[name] = wrapValue(value)
      }
      graph[String(node.id)] = { class_type: type, inputs }
      continue
    }
    const widgetValues = Array.isArray(rawWidgets) ? [...rawWidgets] : []
    const def = options.objectInfo?.[type]

    interface ConsumptionUnit {
      kind: 'value' | 'skip'
      name?: string
      forceInputDummy?: boolean
    }

    let units: ConsumptionUnit[] = []
    if (widgetEntries.length > 0) {
      // 新格式：优先按前端序列化的 widget 顺序映射（子图/自定义节点与 /object_info 顺序可能不一致）
      for (const entry of widgetEntries) {
        const widgetName = entry.widget!.name!
        if (entry.link != null || linkedInputNames.has(widgetName)) {
          // 已连线/转输入的 widget：值由链路提供，位置占位跳过
          units.push({ kind: 'skip' })
          continue
        }
        units.push({ kind: 'value', name: widgetName })
        const spec = specForInputName(def, widgetName)
        if (hasControlAfterGenerate(spec)) units.push({ kind: 'skip' })
      }
    } else if (def) {
      for (const { name, spec } of orderedInputSpecs(def)) {
        if (linkedInputNames.has(name)) continue
        if (isWidgetSpec(spec)) {
          units.push({ kind: 'value', name })
          if (hasControlAfterGenerate(spec)) units.push({ kind: 'skip' })
        } else if (isForceInput(spec)) {
          units.push({ kind: 'skip', forceInputDummy: true })
        }
      }
    } else {
      // 兜底：内置常见核心节点映射
      units = fallbackUnits(type).filter((u) => u.kind !== 'value' || !linkedInputNames.has(u.name!))
    }

    // 占位/已连线值是否存在于 widgets_values 因序列化版本而异；按长度匹配决定是否消费占位
    const consumeAll = widgetValues.length === units.length
    const consumption = consumeAll
      ? units
      : units.filter((u) => u.kind !== 'skip' || u.forceInputDummy)

    let valueIndex = 0
    for (const unit of consumption) {
      const value = widgetValues[valueIndex]
      if (unit.kind === 'value' && unit.name && value !== undefined) {
        inputs[unit.name] = wrapValue(value)
      }
      valueIndex += 1
    }

    if (valueIndex < widgetValues.length) {
      const leftover = widgetValues.slice(valueIndex)
      if (isSilentExtraFamily(type)) {
        // LoadImage 家族第二个参数是 upload 按钮占位值，官方导出会带上 upload 键
        if (isLoadImageFamily(type) && inputs.upload === undefined && leftover.length > 0) {
          inputs.upload = wrapValue(leftover[0])
        }
        // 其余多余值为前端 UI 状态（上传按钮、预览等），与 ComfyUI 官方导出行为一致，直接忽略
      } else {
        // 未识别节点：参数无法命名，原样保留，避免导入后丢失
        inputs.widgets_values = leftover.map((value) => wrapValue(value))
        warnings.push(
          `节点 ${node.id}（${type}）为自定义/未识别节点，${leftover.length} 个参数值已保留在 widgets_values 中，请导入后核对。`,
        )
      }
    }

    graph[String(node.id)] = { class_type: type, inputs }
  }

  // 清理指向被排除节点的引用
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (key === 'widgets_values') continue
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
    case 'SaveImageAdvanced':
      return toUnits(['filename_prefix'])
    case 'SaveAnimatedWEBP':
      return toUnits(['filename_prefix', 'fps', 'lossless', 'quality', 'method'])
    case 'LoadImage':
      return toUnits(['image', 'upload'])
    case 'LoadImageMask':
      return toUnits(['image', 'channel'])
    case 'LoadImageOutput':
      return toUnits(['image'])
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
