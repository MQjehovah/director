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

export interface SubgraphEndpoint {
  name?: string
  linkIds?: number[]
  label?: string
}

export interface SubgraphLink {
  id: number
  origin_id: number | string
  origin_slot: number
  target_id: number | string
  target_slot: number
  type?: string
}

export interface SubgraphDef {
  id: string
  inputNode?: { id: number | string }
  outputNode?: { id: number | string }
  inputs?: SubgraphEndpoint[]
  outputs?: SubgraphEndpoint[]
  widgets?: Array<{ name?: string }>
  nodes?: WorkflowUiNode[]
  links?: SubgraphLink[]
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

/** 注释/便签节点：纯前端展示，不参与执行，ComfyUI 后端没有对应节点类 */
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

/** 子图实例节点类型：ComfyUI 子图使用 UUID 作为 class_type */
const SUBGRAPH_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseSubgraphDefs(parsed: unknown): Map<string, SubgraphDef> {
  const out = new Map<string, SubgraphDef>()
  if (!isRecord(parsed) || !isRecord(parsed.definitions)) return out
  const defs = parsed.definitions.subgraphs
  if (!Array.isArray(defs)) return out
  for (const d of defs) {
    if (isRecord(d) && typeof d.id === 'string') out.set(d.id, d as unknown as SubgraphDef)
  }
  return out
}

/**
 * 从 UI 格式工作流中提取参数显示名：
 * 子图 def.inputs 暴露的参数（实例输入 label 优先，如 enable_turbo_mode / clip_name），
 * 沿 -10 边界链接映射到内部节点输入，返回 `${实例ID}:${内部ID}:${输入名}` → label。
 */
export function detectParameterLabels(parsed: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !isRecord(parsed.definitions)) {
    return labels
  }
  const subgraphDefs = parseSubgraphDefs(parsed)
  for (const node of parsed.nodes) {
    if (!isRecord(node) || node.id === undefined || typeof node.type !== 'string') continue
    const def = subgraphDefs.get(node.type)
    if (!def) continue
    const inputNodeId = def.inputNode?.id ?? -10
    for (const ep of def.inputs ?? []) {
      if (!ep.name) continue
      // 实例输入 label 优先（如 enable_turbo_mode），其次 def.inputs 的 label（如 clip_name）
      const instanceEntry = Array.isArray(node.inputs)
        ? (node.inputs as WorkflowNodeInputEntry[]).find((e) => e.name === ep.name)
        : undefined
      const label = instanceEntry?.label ?? ep.label
      if (typeof label !== 'string' || label.length === 0) continue
      for (const lid of ep.linkIds ?? []) {
        const link = (def.links ?? []).find((l) => l.id === lid)
        if (!link || link.origin_id !== inputNodeId) continue
        const inner = (def.nodes ?? []).find((n) => n.id === link.target_id)
        const inputName = inner?.inputs?.[link.target_slot]?.name
        if (inner?.id !== undefined && inputName) {
          labels[`${node.id}:${inner.id}:${inputName}`] = label
        }
      }
    }
  }
  return labels
}

/** 无 /object_info 时的 control_after_generate 占位名（与 fallbackUnits 的 controlAfter 对应） */
function fallbackControlAfterNames(type: string): Set<string> {
  switch (type) {
    case 'KSampler':
      return new Set(['seed'])
    case 'KSamplerAdvanced':
      return new Set(['seed'])
    case 'RandomNoise':
      return new Set(['noise_seed'])
    case 'PrimitiveFloat':
    case 'PrimitiveInt':
    case 'PrimitiveString':
      return new Set(['value'])
    default:
      return new Set()
  }
}

/**
 * widgets_values → 命名输入（新格式声明名 / /object_info 定义 / 内置兜底）。
 * 与 ComfyUI 前端 graphToPrompt 一致：多余值若是已知前端附加参数则静默忽略，
 * 未识别节点的多余值原样保留在 widgets_values 并告警。
 */
function mapWidgetValuesToInputs(
  node: WorkflowUiNode,
  type: string,
  inputs: Record<string, unknown>,
  linkedInputNames: Set<string>,
  widgetEntries: WorkflowNodeInputEntry[],
  options: ConvertOptions,
  warnings: string[],
  label: string,
): void {
  const rawWidgets = node.widgets_values
  // 自定义序列化（如 VHS 系列）：widgets_values 直接是 { 参数名: 值 } 对象
  if (isRecord(rawWidgets)) {
    for (const [name, value] of Object.entries(rawWidgets)) {
      if (!linkedInputNames.has(name)) inputs[name] = wrapValue(value)
    }
    return
  }
  const widgetValues = Array.isArray(rawWidgets) ? [...rawWidgets] : []
  const def = options.objectInfo?.[type]

  interface ConsumptionUnit {
    kind: 'value' | 'skip'
    name?: string
    forceInputDummy?: boolean
    controlAfter?: boolean
  }

  let units: ConsumptionUnit[] = []
  if (widgetEntries.length > 0) {
    const namedEntries = (node.inputs ?? []).filter((e) => e.name)
    // 构建消费单元：pure 只按实际 widget 条目映射；hybrid 额外把「已连线/转输入的 widget」
    // 也按位置占位跳过——旧式/混合序列化会把其占位值留在 widgets_values 中，
    // 只按 widget 条目映射会让后续参数整体错位（如 CLIPLoader 的 type 拿到模型文件名）
    const buildUnits = (hybrid: boolean): ConsumptionUnit[] => {
      const out: ConsumptionUnit[] = []
      for (const entry of namedEntries) {
        const name = entry.name!
        const spec = specForInputName(def, name)
        const widgetish =
          !!entry.widget?.name ||
          (hybrid &&
            (isWidgetSpec(spec) ||
              isForceInput(spec) ||
              fallbackUnits(type).some((u) => u.name === name)))
        if (!widgetish) continue
        if (!entry.widget?.name && isForceInput(spec) && entry.link == null) {
          out.push({ kind: 'skip', forceInputDummy: true })
          continue
        }
        const hasPlaceholder =
          hasControlAfterGenerate(spec) || fallbackControlAfterNames(type).has(name)
        if (entry.link != null || linkedInputNames.has(name)) {
          // 已连线/转输入的 widget：值由链路提供，位置占位跳过
          out.push({ kind: 'skip', name })
          if (hasPlaceholder) out.push({ kind: 'skip', controlAfter: true })
          continue
        }
        out.push({ kind: 'value', name })
        if (hasPlaceholder) out.push({ kind: 'skip', controlAfter: true })
      }
      return out
    }
    const pureUnits = buildUnits(false)
    const hybridUnits = buildUnits(true)
    const valuesLen = widgetValues.length
    // 按 widgets_values 实际长度选择匹配的方案；不匹配时退回纯 widget 方案
    units =
      hybridUnits.length > pureUnits.length &&
      (valuesLen === hybridUnits.length ||
        (valuesLen > pureUnits.length && valuesLen < hybridUnits.length))
        ? hybridUnits
        : pureUnits
  } else if (def) {
    for (const { name, spec } of orderedInputSpecs(def)) {
      if (linkedInputNames.has(name)) {
        // 已连线：值由链路提供；旧式序列化会在 widgets_values 中保留占位值，占位跳过
        units.push({ kind: 'skip', name })
        if (hasControlAfterGenerate(spec)) units.push({ kind: 'skip', controlAfter: true })
        continue
      }
      if (isWidgetSpec(spec)) {
        units.push({ kind: 'value', name })
        if (hasControlAfterGenerate(spec)) units.push({ kind: 'skip', controlAfter: true })
      } else if (isForceInput(spec)) {
        units.push({ kind: 'skip', forceInputDummy: true })
      }
    }
  } else {
    // 兜底：内置常见核心节点映射；已连线的值由链路提供，但保留其位置占位，
    // 否则旧式序列化（widgets_values 含占位值）会导致后续参数整体错位
    units = fallbackUnits(type).map((u) =>
      u.kind === 'value' && u.name !== undefined && linkedInputNames.has(u.name)
        ? { kind: 'skip', name: u.name }
        : u,
    )
  }

  // 占位/已连线值是否存在于 widgets_values 因序列化版本而异；按长度匹配决定是否消费占位。
  // 未匹配时只丢弃 control_after_generate 占位，保留已连线值的占位位置，避免后续参数错位
  const consumeAll = widgetValues.length === units.length
  const consumption = consumeAll
    ? units
    : units.filter((u) => u.kind !== 'skip' || u.forceInputDummy || !u.controlAfter)

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
        `${label}为自定义/未识别节点，${leftover.length} 个参数值已保留在 widgets_values 中，请导入后核对。`,
      )
    }
  }
}

/**
 * 展开子图实例节点：把 definitions.subgraphs 中的内部节点展开为 API 节点，
 * 执行 ID 采用 ComfyUI 约定的「实例ID:内部ID」（嵌套时逐级拼接）。
 * 边界输入经 inputNode(-10) 由父级链接注入；边界输出经 outputNode(-20) 记录到 outputMap，
 * 供最终引用重写；proxyWidgets/def.widgets 把实例的 widgets_values 覆盖到内部节点同名 widget。
 */
function expandSubgraphNode(
  instance: WorkflowUiNode,
  def: SubgraphDef,
  instanceIdPrefix: string,
  resolveLink: (linkId: number | null | undefined) => unknown | undefined,
  graph: ApiWorkflowGraph,
  subgraphDefs: Map<string, SubgraphDef>,
  expandedOutputs: Map<string, Map<number, { execId: string; slot: number }>>,
  options: ConvertOptions,
  warnings: string[],
  depth = 0,
): Map<number, { execId: string; slot: number }> {
  const outputMap = new Map<number, { execId: string; slot: number }>()
  if (depth > 8) {
    warnings.push(`子图 ${def.id} 嵌套过深（>8 层），已停止展开。`)
    return outputMap
  }

  const innerNodesById = new Map<number | string, WorkflowUiNode>()
  for (const n of def.nodes ?? []) {
    if (n && n.id !== undefined) innerNodesById.set(n.id, n)
  }
  const innerLinks = new Map<number, SubgraphLink>()
  for (const l of def.links ?? []) {
    if (l && typeof l.id === 'number') innerLinks.set(l.id, l)
  }

  const inputNodeId = def.inputNode?.id ?? -10
  const outputNodeId = def.outputNode?.id ?? -20
  const execIdOf = (nodeId: number | string): string => `${instanceIdPrefix}${nodeId}`

  const instanceValues = Array.isArray(instance.widgets_values) ? instance.widgets_values : []
  // 实例的 widgets_values 与「带 widget 的输入条目」按顺序对齐（暴露的 widget 参数）
  const instanceWidgetEntries = (instance.inputs ?? []).filter((e) => e.widget?.name)

  // 边界输入：父级链接解析值 → 内部节点输入（key `${targetId}:${targetSlot}`）；
  // 实例无链接的暴露参数（值在 widgets_values 中）按 widget 条目顺序对齐后注入
  const boundaryInputs = new Map<string, unknown>()
  const exposedInputs = def.inputs ?? []
  for (let i = 0; i < exposedInputs.length; i += 1) {
    const ep = exposedInputs[i]
    const instanceEntry =
      instance.inputs?.find((e) => e.name === ep.name) ?? instance.inputs?.[i]
    let value = resolveLink(instanceEntry?.link)
    if (value === undefined && instanceEntry?.link == null) {
      const widgetIndex = instanceEntry ? instanceWidgetEntries.indexOf(instanceEntry) : -1
      if (widgetIndex >= 0 && widgetIndex < instanceValues.length) {
        value = wrapValue(instanceValues[widgetIndex])
      }
    }
    for (const lid of ep.linkIds ?? []) {
      const l = innerLinks.get(lid)
      if (l && l.origin_id === inputNodeId) {
        boundaryInputs.set(`${l.target_id}:${l.target_slot}`, value)
      }
    }
  }

  // 边界输出：内部节点输出槽 → 父级输出槽
  const exposedOutputs = def.outputs ?? []
  for (let j = 0; j < exposedOutputs.length; j += 1) {
    const ep = exposedOutputs[j]
    for (const lid of ep.linkIds ?? []) {
      const l = innerLinks.get(lid)
      if (l && l.target_id === outputNodeId) {
        outputMap.set(j, { execId: execIdOf(l.origin_id), slot: l.origin_slot })
      }
    }
  }

  // 提升 widget：实例 widgets_values 按 proxyWidgets/def.widgets 顺序覆盖内部节点同名 widget
  /** 提升 widget 覆盖：force=true 为 proxyWidgets 显式映射（无条件覆盖），否则仅缺值时填充 */
  const widgetOverrides = new Map<string, { value: unknown; force: boolean }>()
  const proxyWidgets = Array.isArray(instance.properties?.proxyWidgets)
    ? (instance.properties.proxyWidgets as unknown[])
    : []
  const fallbackNames = (def.widgets ?? []).map((w) => w.name)

  for (let k = 0; k < instanceValues.length; k += 1) {
    const proxy = proxyWidgets[k]
    // 提升 widget 的名称来源：proxyWidgets 的 widget 名 / def.widgets / 实例声明（新格式 inputs 条目）
    const byName =
      (Array.isArray(proxy) && proxy.length >= 2 ? String(proxy[1]) : undefined) ??
      fallbackNames[k] ??
      instanceWidgetEntries[k]?.widget?.name ??
      instance.inputs?.[k]?.name
    let nodeId: string | undefined
    let widgetName: string | undefined
    if (Array.isArray(proxy) && proxy.length >= 2) {
      nodeId = String(proxy[0])
      widgetName = String(proxy[1])
    } else if (typeof proxy === 'string') {
      // 兼容部分旧版本：字符串即内部节点 id，widget 名为 value（Primitive 场景）
      nodeId = proxy
      widgetName = 'value'
    } else if (byName) {
      // 无 proxyWidgets 时按名称在内部节点中查找：widget 名或输入名（兼容旧式序列化）
      const matches = (def.nodes ?? []).filter(
        (n) =>
          n.id !== undefined &&
          n.inputs?.some((e) => e.widget?.name === byName || e.name === byName),
      )
      const hasOwnValue = (n: WorkflowUiNode): boolean =>
        Array.isArray(n.widgets_values) && n.widgets_values.length > 0
      // 优先未连线目标（覆盖会破坏链路）；其次优先尚无自身值的节点（提升用于填充缺值，
      // 避免误填已带默认值的同名输入，如 PrimitiveFloat 与 PrimitiveInt 的 value）
      const entryOf = (n: WorkflowUiNode | undefined) =>
        n?.inputs?.find((e) => e.widget?.name === byName || e.name === byName)
      const target =
        matches.find((n) => {
          const e = entryOf(n)
          return !!e && e.link == null && !hasOwnValue(n)
        }) ??
        matches.find((n) => {
          const e = entryOf(n)
          return !!e && e.link == null
        }) ??
        matches[0]
      const entry = entryOf(target)
      if (target && target.id !== undefined && entry) {
        nodeId = String(target.id)
        widgetName = entry.widget?.name ?? entry.name
      }
    }
    const force = Array.isArray(proxy) || typeof proxy === 'string'
    if (nodeId) widgetOverrides.set(`${nodeId}:${widgetName}`, { value: instanceValues[k], force })
  }

  // 虚拟 PrimitiveNode 值（含覆盖）：供链路内联
  const primitiveValues = new Map<string, unknown>()
  for (const n of def.nodes ?? []) {
    if (!n || n.id === undefined || !isPrimitiveNode(n)) continue
    const key = String(n.id)
    const override = widgetOverrides.get(`${key}:value`)?.value
    primitiveValues.set(key, override !== undefined ? override : n.widgets_values?.[0])
  }

  /** 解析内部链路起点（含 Primitive/Reroute 内联与虚拟节点排除） */
  function resolveInnerOrigin(originId: number | string, originSlot: number): unknown | undefined {
    const originNode = innerNodesById.get(originId)
    if (!originNode) return undefined
    if (isPrimitiveNode(originNode)) {
      return wrapValue(
        primitiveValues.get(String(originId)) ??
          originNode.widgets_values?.[originSlot] ??
          originNode.widgets_values?.[0],
      )
    }
    if (isRerouteNode(originNode)) {
      const entry = originNode.inputs?.find((i) => i.link != null)
      const link = entry?.link != null ? innerLinks.get(entry.link) : undefined
      if (!link) return undefined
      return resolveInnerOrigin(link.origin_id, link.origin_slot)
    }
    if (isVirtualType(originNode.type) || isNoteType(originNode.type)) return undefined
    return [execIdOf(originId), originSlot]
  }

  /** 解析当前子图上下文内的一条内部链接 */
  function resolveInnerLink(linkId: number | null | undefined): unknown | undefined {
    if (linkId == null) return undefined
    const l = innerLinks.get(linkId)
    if (!l) return undefined
    if (l.origin_id === inputNodeId) {
      return boundaryInputs.get(`${l.target_id}:${l.target_slot}`)
    }
    return resolveInnerOrigin(l.origin_id, l.origin_slot)
  }

  for (const inner of def.nodes ?? []) {
    if (!inner || inner.id === undefined) continue
    const innerType = inner.type
    if (!innerType || isExcludedMode(inner.mode)) continue
    if (isVirtualType(innerType) || isNoteType(innerType)) {
      if (isPrimitiveNode(inner)) {
        const key = String(inner.id)
        const override = widgetOverrides.get(`${key}:value`)?.value
        primitiveValues.set(key, override !== undefined ? override : inner.widgets_values?.[0])
      }
      continue
    }
    if (subgraphDefs.has(innerType)) {
      const nestedPrefix = `${execIdOf(inner.id)}:`
      const nestedMap = expandSubgraphNode(
        inner,
        subgraphDefs.get(innerType)!,
        nestedPrefix,
        resolveInnerLink,
        graph,
        subgraphDefs,
        expandedOutputs,
        options,
        warnings,
        depth + 1,
      )
      expandedOutputs.set(execIdOf(inner.id), nestedMap)
      continue
    }

    const execId = execIdOf(inner.id)
    const inputs: Record<string, unknown> = {}
    const linkedInputNames = new Set<string>()
    const widgetEntries: WorkflowNodeInputEntry[] = []

    // 内部连线输入：-10 边界走父级注入值，其余按内部节点解析
    for (const entry of inner.inputs ?? []) {
      const name = entry.name
      if (!name) continue
      if (entry.link != null) {
        linkedInputNames.add(name)
        const l = innerLinks.get(entry.link)
        if (l) {
          const value =
            l.origin_id === inputNodeId
              ? boundaryInputs.get(`${l.target_id}:${l.target_slot}`)
              : resolveInnerOrigin(l.origin_id, l.origin_slot)
          if (value !== undefined) inputs[name] = value
        }
      }
      if (entry.widget?.name) widgetEntries.push(entry)
    }

    mapWidgetValuesToInputs(
      inner,
      innerType,
      inputs,
      linkedInputNames,
      widgetEntries,
      options,
      warnings,
      `节点 ${execId}（${innerType}）`,
    )

    // 提升 widget 覆盖内部节点同名输入
    for (const [key, override] of widgetOverrides) {
      const sep = key.indexOf(':')
      if (sep < 0) continue
      if (key.slice(0, sep) === String(inner.id)) {
        const inputName = key.slice(sep + 1)
        // proxyWidgets 显式映射无条件覆盖；按名兜底仅在输入仍缺值时填充，
        // 避免误覆盖已由边界/自带值提供的目标
        if (override.force || inputs[inputName] === undefined) {
          inputs[inputName] = wrapValue(override.value)
        }
      }
    }

    graph[execId] = { class_type: innerType, inputs }
  }

  return outputMap
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
  const subgraphDefs = parseSubgraphDefs(parsed)
  /** 已展开子图实例的边界输出映射：实例 exec id → {输出槽 → 内部节点输出} */
  const expandedOutputs = new Map<string, Map<number, { execId: string; slot: number }>>()
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

    // 注释/便签节点：直接排除，避免提交时 ComfyUI 报 missing_node_type
    if (isNoteType(type)) {
      continue
    }

    // 子图实例节点：按 definitions.subgraphs 展开为内部节点
    const subgraphDef = subgraphDefs.get(type)
    if (subgraphDef) {
      const outputMap = expandSubgraphNode(
        node,
        subgraphDef,
        `${node.id}:`,
        (linkId) => {
          if (linkId == null) return undefined
          const link = links.get(linkId)
          if (!link) return undefined
          const resolved = resolveOrigin(link[1], link[2])
          if (!resolved) return undefined
          return 'ref' in resolved ? resolved.ref : resolved.value
        },
        graph,
        subgraphDefs,
        expandedOutputs,
        options,
        warnings,
      )
      expandedOutputs.set(String(node.id), outputMap)
      continue
    }
    if (SUBGRAPH_UUID_RE.test(type)) {
      warnings.push(
        `节点 ${node.id}（${type}）为子图实例，但工作流文件缺少 definitions.subgraphs 定义，无法展开，提交时可能报 missing_node_type。`,
      )
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
    mapWidgetValuesToInputs(
      node,
      type,
      inputs,
      linkedInputNames,
      widgetEntries,
      options,
      warnings,
      `节点 ${node.id}（${type}）`,
    )

    graph[String(node.id)] = { class_type: type, inputs }
  }

  // 重写指向已展开子图实例的引用（顶层/边界/嵌套），映射到内部节点输出
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string' &&
        typeof value[1] === 'number'
      ) {
        const outMap = expandedOutputs.get(value[0])
        if (outMap) {
          const mapped = outMap.get(value[1])
          if (mapped) node.inputs[key] = [mapped.execId, mapped.slot]
          else delete node.inputs[key]
        }
      }
    }
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
    const out: Array<{ kind: 'value' | 'skip'; name?: string; controlAfter?: boolean }> = []
    for (const name of names) {
      out.push({ kind: 'value', name })
      if (controlAfter.has(name)) out.push({ kind: 'skip', controlAfter: true })
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
    case 'ComfySwitchNode':
    case 'ComfySoftSwitchNode':
      // ComfyUI 核心逻辑节点：switch 是唯一 widget，on_false/on_true 由连线提供
      return [
        { kind: 'value', name: 'switch' },
        { kind: 'skip', name: 'on_false' },
        { kind: 'skip', name: 'on_true' },
      ]
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
