import { AssetSchema, JobSchema } from '../../core/models'
import type { Asset, Job } from '../../core/models'
import type { ProviderPlugin } from '../../core/plugin/types'
import type {
  ImageToVideoParams,
  MediaProvider,
  TextToImageParams,
  TextToVideoParams,
} from '../../providers/MediaProvider'
import type { ImageEditParams } from '../../providers/capabilities/image-edit'
import { createJobController } from '../../providers/capabilities'
import { loadProviderConfig } from '../../features/settings/httpBackendConfig'
import { getWorkflowTemplate } from '../../features/comfyui/workflowStore'
import { usePluginStore } from '../../stores/pluginStore'

export const MEDIA_COMFYUI_ID = 'media-comfyui'

export type WsCtor = typeof WebSocket

export interface MediaComfyUIOptions {
  pollIntervalMs?: number
  wsCtor?: WsCtor
}

/** 默认文生图工作流模板（ComfyUI API 格式），支持 {prompt}/{negative_prompt}/{seed} 占位符 */
export const DEFAULT_TXT2IMG_WORKFLOW = JSON.stringify({
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: '{seed}',
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'model.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 768, height: 768, batch_size: 1 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{prompt}', clip: ['4', 1] },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{negative_prompt}', clip: ['4', 1] },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'ai-director', images: ['8', 0] },
  },
})

/**
 * 内置 MiniMax H3 视频工作流（来自导演台常用模板）：
 * 提示词/seed/时长用占位符，first_frame / last_frame 由动态搭建逻辑按需接线（首帧/尾帧图）。
 */
export const DEFAULT_MINIMAX_H3_WORKFLOW = JSON.stringify({
  '92': {
    class_type: 'SaveVideo',
    inputs: {
      filename_prefix: 'video/MiniMax_H3',
      format: 'auto',
      codec: 'auto',
      video: ['105:91', 0],
    },
  },
  '115': {
    class_type: 'ResolutionSelector',
    inputs: { aspect_ratio: '16:9 (Widescreen)', megapixels: 0.2, multiple: 32 },
  },
  '105:11': {
    class_type: 'VAELoader',
    inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' },
  },
  '105:24': {
    class_type: 'VAELoader',
    inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' },
  },
  '105:23': {
    class_type: 'VAEDecodeAudio',
    inputs: { samples: ['105:14', 0], vae: ['105:24', 0] },
  },
  '105:10': {
    class_type: 'VAEDecode',
    inputs: { samples: ['105:14', 0], vae: ['105:11', 0] },
  },
  '105:17': {
    class_type: 'KSamplerSelect',
    inputs: { sampler_name: 'res_multistep' },
  },
  '105:9': {
    class_type: 'BasicScheduler',
    inputs: { scheduler: 'simple', steps: 20, denoise: 1, model: ['105:121', 0] },
  },
  '105:14': {
    class_type: 'SamplerCustomAdvanced',
    inputs: {
      noise: ['105:15', 0],
      guider: ['105:16', 0],
      sampler: ['105:17', 0],
      sigmas: ['105:9', 0],
      latent_image: ['105:104', 1],
    },
  },
  '105:16': {
    class_type: 'BasicGuider',
    inputs: { model: ['105:121', 0], conditioning: ['105:104', 0] },
  },
  '105:6': {
    class_type: 'UNETLoader',
    inputs: { unet_name: 'minimax_h3_fl2va_pruned_nvfp4.safetensors', weight_dtype: 'default' },
  },
  '105:13': {
    class_type: 'CLIPLoader',
    inputs: {
      clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      type: 'minimax',
      device: 'default',
    },
  },
  '105:15': {
    class_type: 'RandomNoise',
    inputs: { noise_seed: '{seed}' },
  },
  '105:91': {
    class_type: 'CreateVideo',
    inputs: { fps: 24, bit_depth: 8, images: ['105:10', 0], audio: ['105:23', 0] },
  },
  '105:104': {
    class_type: 'MiniMaxH3ImageToVideo',
    inputs: {
      prompt: '{prompt}',
      width: ['115', 0],
      height: ['115', 1],
      length: ['105:107', 1],
      clip: ['105:122', 0],
      vae: ['105:11', 0],
    },
  },
  '105:107': {
    class_type: 'ComfyMathExpression',
    inputs: {
      expression: 'max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17',
      'values.a': ['105:111', 0],
    },
  },
  '105:111': {
    class_type: 'PrimitiveFloat',
    inputs: { value: '{duration}' },
  },
  '105:121': {
    class_type: 'SelectModelDevice',
    inputs: { device: 'gpu:2', model: ['105:6', 0] },
  },
  '105:122': {
    class_type: 'SelectCLIPDevice',
    inputs: { device: 'gpu:1', clip: ['105:13', 0] },
  },
})

export interface MediaComfyUIProvider extends MediaProvider {
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
  getAsset(assetId: string): Promise<Asset | undefined>
  resumeJob(job: Job): Promise<Job>
}

interface ComfyHistory {
  [promptId: string]: {
    status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
    outputs?: Record<
      string,
      {
        images?: Array<{ filename: string; subfolder?: string; type?: string }>
        gifs?: Array<{ filename: string; subfolder?: string; type?: string; format?: string }>
      }
    >
  }
}

function readConfig(): {
  baseUrl: string
  workflowTemplateId?: string
  textVideoWorkflowTemplateId?: string
  imageVideoWorkflowTemplateId?: string
  firstLastFrameWorkflowTemplateId?: string
  videoWorkflowTemplateId?: string
  img2imgWorkflowTemplateId?: string
} {
  const config = loadProviderConfig(MEDIA_COMFYUI_ID) ?? {}
  const baseUrl = String(config.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error('ComfyUI 未配置：请在「设置 → ComfyUI 媒体」填写地址（Base URL）。')
  }
  const workflowTemplateId =
    typeof config.workflowTemplateId === 'string' && config.workflowTemplateId.trim() !== ''
      ? config.workflowTemplateId.trim()
      : undefined
  const videoWorkflowTemplateId =
    typeof config.videoWorkflowTemplateId === 'string' &&
    config.videoWorkflowTemplateId.trim() !== ''
      ? config.videoWorkflowTemplateId.trim()
      : undefined
  const textVideoWorkflowTemplateId =
    typeof config.textVideoWorkflowTemplateId === 'string' &&
    config.textVideoWorkflowTemplateId.trim() !== ''
      ? config.textVideoWorkflowTemplateId.trim()
      : undefined
  const imageVideoWorkflowTemplateId =
    typeof config.imageVideoWorkflowTemplateId === 'string' &&
    config.imageVideoWorkflowTemplateId.trim() !== ''
      ? config.imageVideoWorkflowTemplateId.trim()
      : undefined
  const firstLastFrameWorkflowTemplateId =
    typeof config.firstLastFrameWorkflowTemplateId === 'string' &&
    config.firstLastFrameWorkflowTemplateId.trim() !== ''
      ? config.firstLastFrameWorkflowTemplateId.trim()
      : undefined
  const img2imgWorkflowTemplateId =
    typeof config.img2imgWorkflowTemplateId === 'string' &&
    config.img2imgWorkflowTemplateId.trim() !== ''
      ? config.img2imgWorkflowTemplateId.trim()
      : undefined
  return {
    baseUrl,
    workflowTemplateId,
    textVideoWorkflowTemplateId,
    imageVideoWorkflowTemplateId,
    firstLastFrameWorkflowTemplateId,
    videoWorkflowTemplateId,
    img2imgWorkflowTemplateId,
  }
}

type WorkflowGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

function uniqueNodeId(graph: WorkflowGraph, base: string): string {
  let id = base
  let i = 1
  while (id in graph) {
    i += 1
    id = `${base}_${i}`
  }
  return id
}

/** 递归替换占位符：兼容 autogrow 容器 */
function replaceValue(
  value: unknown,
  placeholder: string,
  ref: [string, number] | undefined,
): void {
  if (Array.isArray(value)) {
    for (const item of value) replaceValue(item, placeholder, ref)
    return
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (record[key] === placeholder) {
        if (ref) record[key] = ref
        else delete record[key]
      } else {
        replaceValue(record[key], placeholder, ref)
      }
    }
  }
}

/** 把引用占位符替换为节点引用；ref 为空时删除对应输入，避免悬空引用 */
function replaceInputRef(
  graph: WorkflowGraph,
  placeholder: string,
  ref: [string, number] | undefined,
): void {
  for (const node of Object.values(graph)) {
    replaceValue(node.inputs, placeholder, ref)
  }
}

/**
 * 动态注入工作流输入：
 * - 值占位符 {image}/{last_frame}/{duration}：替换为文件名/时长；
 * - 节点引用占位符 {image_link}/{last_frame_link}：有输入时动态插入 LoadImage 节点并接线，
 *   无输入时删除对应输入，避免空节点报错；
 * - 尾帧未配置占位符时，自动接到模板中现存的 last_frame / end_frame 输入。
 */
function applyDynamicInputs(
  graph: WorkflowGraph,
  opts: {
    inputImage?: { name: string; subfolder?: string; type?: string }
    lastFrame?: { name: string; subfolder?: string; type?: string }
    duration?: number
  },
): void {
  const rawGraphJson = JSON.stringify(graph)
  const hadLastFramePlaceholder =
    rawGraphJson.includes('{last_frame}') || rawGraphJson.includes('{last_frame_link}')
  if (opts.inputImage) {
    let replaced = false
    for (const node of Object.values(graph)) {
      for (const key of Object.keys(node.inputs)) {
        if (node.inputs[key] === '{image}') {
          node.inputs[key] = opts.inputImage.name
          replaced = true
        }
      }
    }
    if (!replaced) {
      const loadImageId = Object.keys(graph).find((id) => graph[id].class_type === 'LoadImage')
      if (loadImageId && graph[loadImageId].inputs) {
        graph[loadImageId].inputs.image = opts.inputImage.name
        if (opts.inputImage.subfolder) graph[loadImageId].inputs.subfolder = opts.inputImage.subfolder
        if (opts.inputImage.type) graph[loadImageId].inputs.type = opts.inputImage.type
      }
    }
  }
  if (opts.lastFrame) {
    for (const node of Object.values(graph)) {
      for (const key of Object.keys(node.inputs)) {
        if (node.inputs[key] === '{last_frame}') {
          node.inputs[key] = opts.lastFrame.name
        }
      }
    }
  }
  if (opts.duration !== undefined) {
    let replaced = false
    for (const node of Object.values(graph)) {
      for (const key of Object.keys(node.inputs)) {
        if (node.inputs[key] === '{duration}') {
          node.inputs[key] = opts.duration
          replaced = true
        }
      }
    }
    if (!replaced) {
      // MiniMax 等模板的时长由子图内 PrimitiveFloat（如 227:132）提供；
      // 旧版展开图缺值时，用本次请求的时长补上
      for (const node of Object.values(graph)) {
        if (node.class_type === 'PrimitiveFloat' && node.inputs.value === undefined) {
          node.inputs.value = opts.duration
        }
      }
    }
  }

  if (opts.inputImage) {
    const id = uniqueNodeId(graph, 'ai-director-image')
    graph[id] = { class_type: 'LoadImage', inputs: { image: opts.inputImage.name } }
    if (opts.inputImage.subfolder) graph[id].inputs.subfolder = opts.inputImage.subfolder
    if (opts.inputImage.type) graph[id].inputs.type = opts.inputImage.type
    replaceInputRef(graph, '{image_link}', [id, 0])
  } else {
    replaceInputRef(graph, '{image_link}', undefined)
  }

  if (opts.lastFrame) {
    const id = uniqueNodeId(graph, 'ai-director-last-image')
    graph[id] = { class_type: 'LoadImage', inputs: { image: opts.lastFrame.name } }
    if (opts.lastFrame.subfolder) graph[id].inputs.subfolder = opts.lastFrame.subfolder
    if (opts.lastFrame.type) graph[id].inputs.type = opts.lastFrame.type
    replaceInputRef(graph, '{last_frame_link}', [id, 0])
    if (!hadLastFramePlaceholder) {
      // 模板没有占位符：尝试接上现存的 last_frame / end_frame 输入
      let wired = false
      for (const node of Object.values(graph)) {
        const key = Object.keys(node.inputs).find((k) => k === 'last_frame' || k === 'end_frame')
        if (!key) continue
        const current = node.inputs[key]
        if (
          Array.isArray(current) &&
          typeof current[0] === 'string' &&
          graph[current[0]]?.class_type === 'LoadImage'
        ) {
          graph[current[0]].inputs.image = opts.lastFrame.name
          if (opts.lastFrame.subfolder) graph[current[0]].inputs.subfolder = opts.lastFrame.subfolder
          if (opts.lastFrame.type) graph[current[0]].inputs.type = opts.lastFrame.type
          wired = true
        } else {
          node.inputs[key] = [id, 0]
          wired = true
        }
        break
      }
      if (!wired) {
        throw new Error(
          '视频工作流模板未配置尾帧占位符：请在模板中添加 {last_frame} 或 {last_frame_link}，或使用 MiniMax H3 模板的 last_frame 输入。',
        )
      }
    }
  } else {
    replaceInputRef(graph, '{last_frame_link}', undefined)
  }
}

/** 由 HTTP baseUrl 推导 WebSocket 地址：http→ws、https→wss，路径固定为 /ws */
function deriveWsUrl(baseUrl: string, clientId: string): string {
  const url = new URL(baseUrl)
  const protocol = url.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${url.host}/ws?clientId=${clientId}`
}

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** 把占位符注入工作流图（避免文本里含引号破坏 JSON） */
function injectPlaceholders(
  workflowJson: string,
  prompt: string,
  negativePrompt: string | undefined,
  seed: number,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const graph = JSON.parse(workflowJson) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >
  for (const node of Object.values(graph)) {
    for (const key of Object.keys(node.inputs)) {
      const value = node.inputs[key]
      if (value === '{prompt}') node.inputs[key] = prompt
      else if (value === '{negative_prompt}') node.inputs[key] = negativePrompt ?? ''
      else if (value === '{seed}') node.inputs[key] = seed
    }
  }
  return graph
}

interface TemplateNodeIds {
  promptNodeId?: string
  negativeNodeId?: string
  seedNodeId?: string
}

/** 纯前端节点类型：ComfyUI 后端没有对应节点类，提交前必须剔除 */
const UI_ONLY_NODE_TYPES = new Set(['MarkdownNote', 'Note', 'Comment'])

/** 子图实例节点的 class_type 是 UUID：未展开时 ComfyUI 后端不认识 */
const SUBGRAPH_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 旧模板兜底：ComfySwitchNode 的 switch widget 值曾残留在 widgets_values 里，需提升为必填输入 */
const SWITCH_NODE_TYPES = new Set(['ComfySwitchNode', 'ComfySoftSwitchNode'])

/** 解析 ComfyUI 校验错误（node_errors）为可读摘要；无法解析时原样返回 */
function describeValidationError(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return text
    const body = parsed as {
      node_errors?: Record<string, { errors?: Array<{ type?: string; message?: string; details?: string }> }>
    }
    const nodeErrors = body.node_errors
    if (!nodeErrors || typeof nodeErrors !== 'object') return text
    const parts: string[] = []
    for (const [nodeId, err] of Object.entries(nodeErrors)) {
      const messages = (err?.errors ?? [])
        .map((e) => e?.message || e?.details || e?.type)
        .filter((m): m is string => typeof m === 'string' && m.length > 0)
      if (messages.length > 0) parts.push(`节点 ${nodeId}：${messages.join('；')}`)
    }
    return parts.length > 0 ? `ComfyUI 校验失败：${parts.join('；')}` : text
  } catch {
    return text
  }
}

/**
 * 提交前清理模板图：
 * - 剔除纯前端注释/便签节点（否则 ComfyUI 报 missing_node_type）；
 * - 移除我们导入时保留的 widgets_values 标记键（不是真实输入，避免污染请求）；
 * - 旧模板中 ComfySwitchNode 的 switch 值若残留在 widgets_values，提升为命名输入再移除；
 * - API 格式旧模板完全缺失 switch 时默认 false（走 on_false 分支），避免校验拒绝。
 * - 未展开的子图 UUID 节点给出明确提示（旧模板需重新导入以展开）。
 */
function stripUiOnlyNodes(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const cleaned: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {}
  for (const [id, node] of Object.entries(graph)) {
    if (SUBGRAPH_UUID_RE.test(node.class_type)) {
      throw new Error(
        `模板包含未展开的子图节点（${node.class_type}，节点 #${id}）。请重新导入该工作流模板以展开子图，或确认该子图已作为蓝图安装到 ComfyUI。`,
      )
    }
    if (UI_ONLY_NODE_TYPES.has(node.class_type)) continue
    const inputs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.inputs)) {
      if (key === 'widgets_values') {
        // 旧模板：ComfySwitchNode 的 switch 值残留在 widgets_values 中，提交前恢复为命名输入
        if (
          SWITCH_NODE_TYPES.has(node.class_type) &&
          inputs.switch === undefined &&
          Array.isArray(value) &&
          value.length > 0 &&
          value[0] !== null &&
          value[0] !== undefined
        ) {
          inputs.switch = value[0]
        }
        continue
      }
      inputs[key] = value
    }
    // 自愈：旧模板（尤其直接粘贴 API 格式）可能完全没有 switch 值，默认走 on_false 分支
    if (SWITCH_NODE_TYPES.has(node.class_type) && inputs.switch === undefined) {
      inputs.switch = false
    }
    cleaned[id] = { class_type: node.class_type, inputs }
  }
  return cleaned
}

/** 旧版本模板特征：CLIPLoader 的 type 被错位成模型文件名（早期导入转换 bug 遗留） */
const CLIP_TYPE_FILENAME_RE = /\.(safetensors|gguf|sft|bin)$/i

export function isStaleBrokenTemplate(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): boolean {
  return Object.values(graph).some(
    (n) =>
      n.class_type === 'CLIPLoader' &&
      typeof n.inputs.type === 'string' &&
      CLIP_TYPE_FILENAME_RE.test(n.inputs.type),
  )
}

/**
 * 修复旧版展开图的已知参数错位：
 * - CLIPLoader 的 type 被错位成模型文件名 → 把文件名放回 clip_name，type/device 从错位值和残留 widgets_values 中恢复；
 * - 缺失的 clip_name/unet_name/vae_name/lora_name/value 从残留 widgets_values 中恢复。
 * 返回是否发生过修复。
 */
export function repairLegacyMisalignedGraph(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): boolean {
  let repaired = false
  for (const node of Object.values(graph)) {
    const inputs = node.inputs
    const leftovers = Array.isArray(inputs.widgets_values)
      ? (inputs.widgets_values as unknown[])
      : []
    if (
      node.class_type === 'CLIPLoader' &&
      typeof inputs.type === 'string' &&
      CLIP_TYPE_FILENAME_RE.test(inputs.type)
    ) {
      const strings = [inputs.type, inputs.device, ...leftovers].filter(
        (s): s is string => typeof s === 'string',
      )
      const filename = strings.find((s) => CLIP_TYPE_FILENAME_RE.test(s))
      const typeValue = strings.find(
        (s) => !CLIP_TYPE_FILENAME_RE.test(s) && !['default', 'cpu', 'cuda'].includes(s),
      )
      const deviceValue = strings.find((s) => ['default', 'cpu', 'cuda'].includes(s))
      if (filename) {
        inputs.clip_name = filename
        inputs.type = typeValue ?? 'stable_diffusion'
        inputs.device = deviceValue ?? 'default'
        repaired = true
      }
    }
    for (const key of ['clip_name', 'unet_name', 'vae_name', 'lora_name'] as const) {
      if (inputs[key] === undefined) {
        const v = leftovers.find((x) => typeof x === 'string')
        if (v !== undefined) {
          inputs[key] = v
          repaired = true
        }
      }
    }
    if (inputs.value === undefined) {
      const v = leftovers.find((x) => typeof x === 'number')
      if (v !== undefined) {
        inputs.value = v
        repaired = true
      }
    }
  }
  return repaired
}

/** 提交前检查模板是否为旧版本（参数错位）：先自动修复，仍错位则给出明确指引而不是等 ComfyUI 400 */
function assertFreshTemplate(
  template: { id: string; name: string; graphJson: string },
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const graph = JSON.parse(template.graphJson) as Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  >
  repairLegacyMisalignedGraph(graph)
  if (isStaleBrokenTemplate(graph)) {
    throw new Error(
      `当前使用的工作流模板「${template.name}」是旧版本（导入时参数错位，例如 CLIPLoader 的 type 字段是模型文件名）。` +
        `请在「设置 → ComfyUI 媒体」中按生成类型选择重新导入后的新模板（参考生视频选「参考生视频模板」，文生视频选「文生视频模板」等）；` +
        `如果下拉列表里没有新模板，请先在模板管理中导入并点击「保存模板」。`,
    )
  }
  return graph
}

/** 旧版坏模板无法完全自愈时，精确定位仍缺失的关键输入，而不是等 ComfyUI 400 */
function assertNoMissingCriticalInputs(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): void {
  const required: Record<string, string[]> = {
    PrimitiveFloat: ['value'],
    PrimitiveInt: ['value'],
    VAELoader: ['vae_name'],
    UNETLoader: ['unet_name'],
    CLIPLoader: ['clip_name'],
    LoraLoaderModelOnly: ['lora_name'],
  }
  const missing: string[] = []
  for (const [id, node] of Object.entries(graph)) {
    const keys = required[node.class_type]
    if (!keys) continue
    for (const key of keys) {
      if (node.inputs[key] === undefined) {
        missing.push(`节点 ${id}（${node.class_type}）的 ${key}`)
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `模板仍缺少关键输入：${missing.join('、')}。旧版展开图无法完全自愈，请用 ComfyUI 导出的原始工作流 JSON（nodes/links 格式）重新导入。`,
    )
  }
}

/** 按节点 id 注入 prompt/negative/seed；缺失 prompt 节点时回退到占位符扫描或首个 CLIPTextEncode */
interface ParamContext {
  prompt?: string
  negativePrompt?: string
  seed?: number
  duration?: number
  inputImage?: { name?: string; subfolder?: string; type?: string }
  lastFrame?: { name?: string; subfolder?: string; type?: string }
}

/**
 * 参数覆盖值支持 `${占位符}`（如 ${duration}），生成时替换为镜头上下文；
 * 非占位符原样返回；未识别的占位符返回 undefined（保持模板默认）。
 */
function resolveParamPlaceholder(value: unknown, ctx: ParamContext): unknown {
  if (typeof value !== 'string') return value
  const m = /^\$\{([^}]+)\}$/.exec(value.trim())
  if (!m) return value
  switch (m[1]) {
    case 'duration':
      return ctx.duration
    case 'prompt':
      return ctx.prompt
    case 'negative_prompt':
      return ctx.negativePrompt
    case 'seed':
      return ctx.seed
    case 'image':
      return ctx.inputImage?.name
    case 'last_frame':
      return ctx.lastFrame?.name
    default:
      return undefined
  }
}

function writeScalarInput(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
  nodeId: string,
  key: string,
  value: string | number | boolean,
): boolean {
  const node = graph[nodeId]
  if (!node) return false
  const input = node.inputs[key]
  if (
    input === undefined ||
    typeof input === 'string' ||
    typeof input === 'number' ||
    typeof input === 'boolean'
  ) {
    node.inputs[key] = value
    return true
  }
  // 输入是链路引用（子图展开后的 Primitive* 提供值）：沿引用写入目标节点的 value
  if (Array.isArray(input) && typeof input[0] === 'string') {
    const target = graph[input[0]]
    if (!target) return false
    const targetValue = target.inputs.value
    if (
      targetValue === undefined ||
      typeof targetValue === 'string' ||
      typeof targetValue === 'number'
    ) {
      target.inputs.value = value
      return true
    }
    return writeScalarInput(graph, input[0], 'value', value)
  }
  return false
}

function isRefLike(value: unknown): boolean {
  return Array.isArray(value) && typeof value[0] === 'string'
}

/** 在图中重新定位提示词节点：优先 CLIPTextEncode，其次带 prompt/text 输入（字符串或引用）的节点 */
function findPromptNodeId(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
): string | undefined {
  return (
    Object.keys(graph).find((id) => graph[id].class_type.includes('CLIPTextEncode')) ??
    Object.keys(graph).find(
      (id) =>
        typeof graph[id].inputs.prompt === 'string' || isRefLike(graph[id].inputs.prompt),
    ) ??
    Object.keys(graph).find(
      (id) =>
        typeof graph[id].inputs.text === 'string' || isRefLike(graph[id].inputs.text),
    )
  )
}

function injectIntoNodes(
  graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
  prompt: string,
  negativePrompt: string | undefined,
  seed: number,
  ids: TemplateNodeIds,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  let promptNodeId = ids.promptNodeId
  let promptInjected = false
  // 模板里记录的节点可能已失效（如重新转换后 id 变化）：按实际图修正
  if (promptNodeId && !graph[promptNodeId]) promptNodeId = undefined

  if (!promptNodeId) {
    for (const node of Object.values(graph)) {
      for (const key of Object.keys(node.inputs)) {
        const value = node.inputs[key]
        if (value === '{prompt}') {
          node.inputs[key] = prompt
          promptInjected = true
        } else if (value === '{negative_prompt}') {
          node.inputs[key] = negativePrompt ?? ''
        } else if (value === '{seed}') {
          node.inputs[key] = seed
        }
      }
    }
  }
  if (!promptNodeId && !promptInjected) {
    promptNodeId = findPromptNodeId(graph)
  }

  if (promptNodeId && graph[promptNodeId]) {
    const node = graph[promptNodeId]
    // 自定义节点（如 MiniMaxH3ImageToVideo）用 prompt 字段，CLIPTextEncode 用 text 字段
    const promptInput = node.inputs.prompt
    const textInput = node.inputs.text
    if (typeof promptInput === 'string' || Array.isArray(promptInput)) {
      writeScalarInput(graph, promptNodeId, 'prompt', prompt)
    } else if (typeof textInput === 'string' || Array.isArray(textInput) || textInput === undefined) {
      writeScalarInput(graph, promptNodeId, 'text', prompt)
    } else {
      node.inputs.text = prompt
    }
    promptInjected = true
  } else if (!promptInjected) {
    throw new Error('工作流缺少提示词节点，请重新导入模板或检查模板。')
  }

  let negativeNodeId = ids.negativeNodeId
  if (negativeNodeId && !graph[negativeNodeId]) negativeNodeId = undefined
  if (!negativeNodeId) {
    // 兜底：带 negative_prompt 输入的节点，或除提示词节点外的第二个 CLIPTextEncode
    negativeNodeId =
      Object.keys(graph).find(
        (id) =>
          typeof graph[id].inputs.negative_prompt === 'string' ||
          isRefLike(graph[id].inputs.negative_prompt),
      ) ??
      // 仅当已确定提示词节点时才找“第二个 CLIPTextEncode”，避免把提示词节点误当负向节点
      (promptNodeId !== undefined
        ? Object.keys(graph).find(
            (id) => graph[id].class_type.includes('CLIPTextEncode') && id !== promptNodeId,
          )
        : undefined)
  }
  if (negativeNodeId && graph[negativeNodeId]) {
    const node = graph[negativeNodeId]
    // 自定义节点（如 MiniMax 系列）用 negative_prompt 字段，CLIPTextEncode 用 text 字段
    const negInput = node.inputs.negative_prompt
    const textInput = node.inputs.text
    if (typeof negInput === 'string' || Array.isArray(negInput)) {
      writeScalarInput(graph, negativeNodeId, 'negative_prompt', negativePrompt ?? '')
    } else if (typeof textInput === 'string' || Array.isArray(textInput) || textInput === undefined) {
      writeScalarInput(graph, negativeNodeId, 'text', negativePrompt ?? '')
    } else {
      node.inputs.text = negativePrompt ?? ''
    }
  }
  let seedNodeId = ids.seedNodeId
  if (seedNodeId && !graph[seedNodeId]) seedNodeId = undefined
  if (!seedNodeId) {
    // 兜底：带 noise_seed/seed 输入（数字或引用）的节点
    seedNodeId =
      Object.keys(graph).find(
        (id) =>
          typeof graph[id].inputs.noise_seed === 'number' ||
          isRefLike(graph[id].inputs.noise_seed),
      ) ??
      Object.keys(graph).find(
        (id) => typeof graph[id].inputs.seed === 'number' || isRefLike(graph[id].inputs.seed),
      )
  }
  if (seedNodeId && graph[seedNodeId]) {
    const node = graph[seedNodeId]
    const noiseSeed = node.inputs.noise_seed
    const seedInput = node.inputs.seed
    if (typeof noiseSeed === 'number' || Array.isArray(noiseSeed)) {
      writeScalarInput(graph, seedNodeId, 'noise_seed', seed)
    } else if (typeof seedInput === 'number' || Array.isArray(seedInput) || seedInput === undefined) {
      writeScalarInput(graph, seedNodeId, 'seed', seed)
    } else {
      node.inputs.seed = seed
    }
  }
  return graph
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'mp4':
    case 'm4v':
      return 'video/mp4'
    case 'webm':
      return 'video/webm'
    case 'mov':
      return 'video/quicktime'
    default:
      return 'image/png'
  }
}

function mimeToExt(mime: string): string | undefined {
  const table: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
  }
  return table[mime]
}

export function createMediaComfyUIProvider(opts: MediaComfyUIOptions = {}): MediaComfyUIProvider {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000
  const wsCtor: WsCtor | undefined =
    opts.wsCtor ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
  let seq = 0

  const ctrl = createJobController({ pollIntervalMs })
  const assets = new Map<string, Asset>()

  // ComfyUI 的 progress 事件是全局的（不含 prompt_id）。记录本 provider 已提交的任务 id，
  // 仅当恰好一个任务在跑时把进度上报给它；多个任务并发时跳过，交由粗粒度轮询兜底。
  const activePromptIds = new Set<string>()
  let ws: WebSocket | undefined
  let wsConnected = false
  let wsUnavailable = false

  ctrl.onJobUpdate((job) => {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
      activePromptIds.delete(job.id)
    }
  })

  /** 懒加载并复用单个 WS 连接；无 wsCtor 或连接失败时静默回退到轮询 */
  function ensureWs(baseUrl: string): void {
    if (ws || wsUnavailable || !wsCtor) return
    try {
      ws = new wsCtor(deriveWsUrl(baseUrl, makeClientId()))
    } catch {
      wsUnavailable = true
      return
    }
    ws.onopen = () => {
      wsConnected = true
    }
    ws.onmessage = (event) => {
      let msg: { type?: string; data?: { value?: unknown; max?: unknown } }
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.type !== 'progress') return
      const value = msg.data?.value
      const max = msg.data?.max
      if (typeof value !== 'number' || typeof max !== 'number' || max <= 0) return
      const pct = Math.round((value / max) * 100)
      if (activePromptIds.size !== 1) return
      const id = activePromptIds.values().next().value
      if (typeof id !== 'string') return
      // 进度一旦出现即视为生成中：若任务仍为 queued，先置为 running，避免
      // 进度条在动但状态仍显示「排队中」。
      void ctrl.getJob(id).then((job) => {
        if (job.status === 'queued') {
          ctrl.patchJob(id, { status: 'running', progress: pct })
        } else {
          ctrl.reportProgress(id, pct)
        }
      }).catch(() => {
        ctrl.reportProgress(id, pct)
      })
    }
    ws.onerror = () => {
      wsConnected = false
      ws?.close()
      ws = undefined
    }
    ws.onclose = () => {
      wsConnected = false
      ws = undefined
    }
  }

  function nextId(prefix: string): string {
    seq += 1
    return `${prefix}-${Date.now().toString(36)}-${seq}`
  }

  async function getAsset(assetId: string): Promise<Asset | undefined> {
    return assets.get(assetId)
  }

  /** 解析资产 id → 图片 URL：先查本 provider 生成资产，再回退到存储 Provider（上传图片） */
  async function resolveAssetUrl(assetId: string): Promise<string | undefined> {
    if (assetId.startsWith('data:') || assetId.startsWith('http') || assetId.startsWith('blob:')) {
      return assetId
    }
    const own = assets.get(assetId)
    if (own?.url) return own.url
    if (own?.localPath && !own.localPath.startsWith('idb://')) return own.localPath
    const storage = usePluginStore().storageProvider
    if (storage?.loadAsset) {
      try {
        const asset = await storage.loadAsset(assetId)
        if (asset) return await storage.getAssetUrl(asset)
      } catch {
        // fall through
      }
    }
    return undefined
  }

  async function fetchImage(baseUrl: string, image: { filename: string; subfolder?: string; type?: string }): Promise<{ url: string; mime: string }> {
    const params = new URLSearchParams({ filename: image.filename })
    if (image.subfolder) params.set('subfolder', image.subfolder)
    if (image.type) params.set('type', image.type)
    const viewUrl = `${baseUrl}/view?${params.toString()}`
    const mime = mimeFor(image.filename)
    // 视频走 /view 直链（避免大文件 base64 内嵌导致卡死/失败）；
    // 图片仍转 data URL 内嵌，便于离线/引用。
    if (mime.startsWith('video/')) {
      return { url: viewUrl, mime }
    }
    const res = await fetch(viewUrl)
    if (!res.ok) throw new Error(`ComfyUI 取图失败（${res.status}）`)
    const buf = new Uint8Array(await res.arrayBuffer())
    return { url: bytesToDataUrl(buf, mime), mime }
  }

  /** 轮询前确认任务未被取消：避免「取消 → 完成」竞态覆盖 canceled 状态 */
  async function pollTask(id: string): Promise<void> {
    const { baseUrl } = readConfig()
    try {
      const res = await fetch(`${baseUrl}/history/${id}`)
      if (!res.ok) throw new Error(`ComfyUI 查询失败（${res.status}）`)
      const history = (await res.json()) as ComfyHistory
      const entry = history[id]
      if (!entry) return
      const status = entry.status?.status_str
      const completed = entry.status?.completed === true
      if (status === 'error') {
        // 终态后 patchJob 会忽略写入，这里用 fail 统一处理（含 stopPoller）
        ctrl.fail(id, 'ComfyUI 执行出错')
        return
      }
      if (!completed || !entry.outputs) {
        // WS 已连接时由 WS 提供实时进度；轮询只确认 running，避免覆盖精细进度
        if (wsConnected) ctrl.patchJob(id, { status: 'running' })
        else ctrl.patchJob(id, { status: 'running', progress: 50 })
        return
      }
      const images = Object.values(entry.outputs).flatMap((o) => o.images ?? [])
      const gifs = Object.values(entry.outputs).flatMap((o) => o.gifs ?? [])
      // 视频输出优先（SaveVideo → gifs）；其次图片
      const video = gifs[0]
      if (video) {
        const assetId = nextId('asset')
        const { url, mime } = await fetchImage(baseUrl, video)
        const asset = AssetSchema.parse({
          id: assetId,
          kind: 'video',
          source: 'ai',
          url,
          metadata: { mime, format: video.format ?? 'mp4' },
        })
        assets.set(assetId, asset)
        ctrl.stopPoller(id)
        ctrl.patchJob(id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
        return
      }
      if (images.length === 0) {
        ctrl.fail(id, 'ComfyUI 未返回图像或视频')
        return
      }
      const assetId = nextId('asset')
      const { url, mime } = await fetchImage(baseUrl, images[0])
      // ComfyUI 部分版本把 SaveVideo 输出放在 images（filename 为 .mp4，animated: true），
      // 按 mime 判断资产类型，避免视频被误标为图片
      const kind = mime.startsWith('video/') ? 'video' : 'image'
      const asset = AssetSchema.parse({
        id: assetId,
        kind,
        source: 'ai',
        url,
        metadata: { mime },
      })
      assets.set(assetId, asset)
      ctrl.stopPoller(id)
      ctrl.patchJob(id, { status: 'done', progress: 100, result: { assetIds: [assetId] } })
    } catch (err) {
      ctrl.fail(id, err instanceof Error ? err.message : String(err))
    }
  }

  /** 提交工作流到 /prompt 并注册任务轮询；返回已注册的 Job */
  async function submitWorkflow(
    graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
    type: string,
    shotRef: string | undefined,
    seed: number,
  ): Promise<Job> {
    const { baseUrl } = readConfig()
    const res = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const readable = describeValidationError(text)
      const raw = readable === text ? '' : `\n原始响应：${text}`
      throw new Error(`ComfyUI 提交失败（${res.status}）：${readable}${raw}`)
    }
    const data = (await res.json()) as { prompt_id?: string }
    const promptId = data.prompt_id
    if (!promptId) throw new Error('ComfyUI 未返回 prompt_id')
    const job = JobSchema.parse({
      id: promptId,
      type,
      status: 'queued',
      progress: 0,
      shotRef,
      pluginId: MEDIA_COMFYUI_ID,
      params: { seed },
    })
    ctrl.setJob(job)
    activePromptIds.add(job.id)
    ctrl.startPoller(job.id, () => pollTask(job.id), pollIntervalMs)
    return job
  }

  /** 解析工作流模板：按 id 加载并注入提示词/seed/输入图 */
  /** 应用模板参数覆盖（key：`${节点ID}:${输入名}`，如 227:210:switch） */
  function applyWorkflowOverrides(
    graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
    overrides: Record<string, unknown> | undefined,
    ctx: ParamContext,
  ): void {
    if (!overrides || typeof overrides !== 'object') return
    for (const [key, value] of Object.entries(overrides)) {
      const sep = key.lastIndexOf(':')
      if (sep <= 0 || sep >= key.length - 1) continue
      const nodeId = key.slice(0, sep)
      const input = key.slice(sep + 1)
      const node = graph[nodeId]
      if (!node) continue
      const resolved = resolveParamPlaceholder(value, ctx)
      if (resolved === undefined) continue
      node.inputs[input] = resolved
    }
  }

  function buildGraph(
    templateId: string | undefined,
    prompt: string,
    negativePrompt: string | undefined,
    seed: number,
    inputImage?: { name: string; subfolder?: string; type?: string },
    duration?: number,
    lastFrame?: { name: string; subfolder?: string; type?: string },
  ): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
    if (templateId) {
      const template = getWorkflowTemplate(templateId)
    if (!template) {
      throw new Error('ComfyUI 工作流模板不存在，请在「设置」中重新选择或导入模板。')
    }
    const graph = assertFreshTemplate(template)
    const stripped = stripUiOnlyNodes(graph)
    applyWorkflowOverrides(stripped, template.parameterOverrides, {
      prompt,
      negativePrompt,
      seed,
      inputImage,
      duration,
      lastFrame,
    })
    const injected = injectIntoNodes(stripped, prompt, negativePrompt, seed, {
      promptNodeId: template.promptNodeId,
      negativeNodeId: template.negativeNodeId,
      seedNodeId: template.seedNodeId,
    })
      applyDynamicInputs(injected, { inputImage, duration, lastFrame })
      assertNoMissingCriticalInputs(injected)
      return injected
    }
    // 无模板：图片用内置文生图模板；视频明确报错
    if (inputImage) {
      throw new Error('图生视频需要在 ComfyUI 工作流模板中配置 {image} 占位符或 LoadImage 节点。')
    }
    return injectPlaceholders(DEFAULT_TXT2IMG_WORKFLOW, prompt, negativePrompt, seed)
  }

  /** 解析图生图工作流模板：注入提示词/seed，并把上传后的参考图写入 LoadImage/{image} 节点 */
  function buildImg2ImgGraph(
    templateId: string | undefined,
    prompt: string,
    negativePrompt: string | undefined,
    seed: number,
    uploaded: { name: string; subfolder?: string; type?: string },
  ): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
    if (!templateId) {
      throw new Error(
        '未配置图生图工作流模板：请在「设置 → ComfyUI 媒体」的图生图工作流模板中导入并选择。',
      )
    }
    const template = getWorkflowTemplate(templateId)
    if (!template) {
      throw new Error('ComfyUI 图生图工作流模板不存在，请在「设置」中重新导入模板。')
    }
    const graph = assertFreshTemplate(template)
    const stripped = stripUiOnlyNodes(graph)
    applyWorkflowOverrides(stripped, template.parameterOverrides, {
      prompt,
      negativePrompt,
      seed,
      inputImage: uploaded,
    })
    const injected = injectIntoNodes(stripped, prompt, negativePrompt, seed, {
      promptNodeId: template.promptNodeId,
      negativeNodeId: template.negativeNodeId,
      seedNodeId: template.seedNodeId,
    })
    assertNoMissingCriticalInputs(injected)
    let replaced = false
    for (const node of Object.values(injected)) {
      for (const key of Object.keys(node.inputs)) {
        if (node.inputs[key] === '{image}') {
          node.inputs[key] = uploaded.name
          replaced = true
        }
      }
    }
    if (!replaced) {
      const loadImageId = Object.keys(injected).find(
        (id) => injected[id].class_type === 'LoadImage',
      )
      if (loadImageId && injected[loadImageId].inputs) {
        injected[loadImageId].inputs.image = uploaded.name
        if (uploaded.subfolder) injected[loadImageId].inputs.subfolder = uploaded.subfolder
        if (uploaded.type) injected[loadImageId].inputs.type = uploaded.type
      } else {
        throw new Error('图生图工作流缺少 {image} 占位符或 LoadImage 节点，无法注入参考图。')
      }
    }
    return injected
  }

  /** 全动态搭建 MiniMax H3 视频工作流（无需模板）：按需插入首帧/尾帧图 */
  function buildMiniMaxH3Graph(
    prompt: string,
    seed: number,
    duration: number,
    inputImage: { name: string; subfolder?: string; type?: string } | undefined,
    lastFrame: { name: string; subfolder?: string; type?: string } | undefined,
  ): WorkflowGraph {
    const graph = JSON.parse(DEFAULT_MINIMAX_H3_WORKFLOW) as WorkflowGraph
    graph['105:104'].inputs.prompt = prompt
    graph['105:15'].inputs.noise_seed = seed
    applyDynamicInputs(graph, { duration })
    if (inputImage) {
      const imgId = uniqueNodeId(graph, 'ai-director-image')
      graph[imgId] = { class_type: 'LoadImage', inputs: { image: inputImage.name } }
      if (inputImage.subfolder) graph[imgId].inputs.subfolder = inputImage.subfolder
      if (inputImage.type) graph[imgId].inputs.type = inputImage.type
      graph['105:104'].inputs.first_frame = [imgId, 0]
    } else {
      delete graph['105:104'].inputs.first_frame
    }
    if (lastFrame) {
      const lastId = uniqueNodeId(graph, 'ai-director-last-image')
      graph[lastId] = { class_type: 'LoadImage', inputs: { image: lastFrame.name } }
      if (lastFrame.subfolder) graph[lastId].inputs.subfolder = lastFrame.subfolder
      if (lastFrame.type) graph[lastId].inputs.type = lastFrame.type
      graph['105:104'].inputs.last_frame = [lastId, 0]
    } else {
      delete graph['105:104'].inputs.last_frame
    }
    return graph
  }

  /** 把参考图上传到 ComfyUI /upload/image，返回服务器侧文件名，供 LoadImage 使用 */
  async function uploadInputImage(inputUrl: string): Promise<{
    name: string
    subfolder?: string
    type?: string
  }> {
    const { baseUrl } = readConfig()
    const res = await fetch(inputUrl)
    if (!res.ok) throw new Error(`获取参考图失败（${res.status}）`)
    const blob = await res.blob()
    const ext = mimeToExt(blob.type) ?? 'png'
    const form = new FormData()
    form.append('image', blob, `ai-director-ref.${ext}`)
    form.append('overwrite', 'true')
    const uploadRes = await fetch(`${baseUrl}/upload/image`, {
      method: 'POST',
      body: form,
    })
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '')
      throw new Error(`ComfyUI 上传参考图失败（${uploadRes.status}）：${text}`)
    }
    const data = (await uploadRes.json()) as { name?: string; subfolder?: string; type?: string }
    if (!data.name) throw new Error('ComfyUI 上传参考图未返回文件名')
    return { name: data.name, subfolder: data.subfolder, type: data.type }
  }

  async function generateImage(params: TextToImageParams): Promise<Job> {
    const { baseUrl, workflowTemplateId } = readConfig()
    ensureWs(baseUrl)
    const seed = params.seed ?? Math.floor(Math.random() * 1e9)
    const graph = buildGraph(workflowTemplateId, params.prompt, params.negativePrompt, seed)
    return submitWorkflow(graph, 'text2image', params.shotRef, seed)
  }

  /** 图生图（参考生图）：上传参考图后提交 img2img 工作流 */
  async function editImage(params: ImageEditParams): Promise<Job> {
    const { baseUrl, img2imgWorkflowTemplateId } = readConfig()
    // 先校验模板再上传，避免参考图白传
    if (!img2imgWorkflowTemplateId) {
      throw new Error(
        '未配置图生图工作流模板：请在「设置 → ComfyUI 媒体」的图生图工作流模板中导入并选择。',
      )
    }
    if (!getWorkflowTemplate(img2imgWorkflowTemplateId)) {
      throw new Error('ComfyUI 图生图工作流模板不存在，请在「设置」中重新导入模板。')
    }
    ensureWs(baseUrl)
    const inputUrl = await resolveAssetUrl(params.imageAssetId)
    if (!inputUrl) {
      throw new Error('无法解析参考图，请先上传或生成参考图。')
    }
    const uploaded = await uploadInputImage(inputUrl)
    const seed = params.seed ?? Math.floor(Math.random() * 1e9)
    const graph = buildImg2ImgGraph(
      img2imgWorkflowTemplateId,
      params.prompt,
      undefined,
      seed,
      uploaded,
    )
    return submitWorkflow(graph, 'editImage', params.shotRef, seed)
  }

  async function generateVideo(params: ImageToVideoParams | TextToVideoParams): Promise<Job> {
    const {
      baseUrl,
      textVideoWorkflowTemplateId,
      imageVideoWorkflowTemplateId,
      firstLastFrameWorkflowTemplateId,
      videoWorkflowTemplateId,
    } = readConfig()
    ensureWs(baseUrl)
    const seed = Math.floor(Math.random() * 1e9)
    const imageAssetId = 'imageAssetId' in params ? params.imageAssetId : undefined
    const lastFrameAssetId = params.lastFrameAssetId
    const duration = params.duration ?? 5

    const jobType =
      imageAssetId && lastFrameAssetId
        ? 'firstLastFrameVideo'
        : imageAssetId || lastFrameAssetId
          ? 'image2video'
          : 'text2video'
    // 按能力选择模板：优先专用的文生视频/参考生视频/首尾帧模板，回退到通用视频模板
    const templateId =
      jobType === 'firstLastFrameVideo'
        ? firstLastFrameWorkflowTemplateId ?? videoWorkflowTemplateId
        : jobType === 'image2video'
          ? imageVideoWorkflowTemplateId ?? videoWorkflowTemplateId
          : textVideoWorkflowTemplateId ?? videoWorkflowTemplateId

    // 解析并上传首帧/尾帧图到 ComfyUI，把服务器侧文件名注入 LoadImage/{image}/{last_frame}
    let uploadedFirst: { name: string; subfolder?: string; type?: string } | undefined
    if (imageAssetId) {
      const inputUrl = await resolveAssetUrl(imageAssetId)
      if (!inputUrl) {
        throw new Error('无法解析输入图，请先生成或上传该镜头的首帧图。')
      }
      uploadedFirst = await uploadInputImage(inputUrl)
    }
    let uploadedLast: { name: string; subfolder?: string; type?: string } | undefined
    if (lastFrameAssetId) {
      const lastUrl = await resolveAssetUrl(lastFrameAssetId)
      if (!lastUrl) {
        throw new Error('无法解析尾帧图，请先上传该镜头的尾帧图。')
      }
      uploadedLast = await uploadInputImage(lastUrl)
    }

    if (!templateId) {
      // 未配置视频模板：全动态搭建 MiniMax H3 工作流（首帧/尾帧按需接线）
      const graph = buildMiniMaxH3Graph(
        params.prompt ?? '',
        seed,
        duration,
        uploadedFirst,
        uploadedLast,
      )
      return submitWorkflow(graph, jobType, params.shotRef, seed)
    }
    const graph = buildGraph(
      templateId,
      params.prompt ?? '',
      undefined,
      seed,
      uploadedFirst,
      duration,
      uploadedLast,
    )
    return submitWorkflow(graph, jobType, params.shotRef, seed)
  }

  /** 刷新/切回项目后恢复运行中的任务：重新注册到控制器并挂上轮询，从 /history/{id} 继续查 */
  async function resumeJob(job: Job): Promise<Job> {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
      return job
    }
    const { baseUrl } = readConfig()
    ensureWs(baseUrl)
    ctrl.setJob(job)
    activePromptIds.add(job.id)
    ctrl.startPoller(job.id, () => pollTask(job.id), pollIntervalMs)
    return job
  }

  return {
    id: MEDIA_COMFYUI_ID,
    name: 'ComfyUI 媒体',
    capabilities: ['text2image', 'text2video', 'image2video', 'firstLastFrameVideo', 'editImage'],
    generateImage,
    generateVideo,
    editImage,
    resumeJob,
    getJob: ctrl.getJob,
    cancelJob: ctrl.cancelJob,
    onJobUpdate: ctrl.onJobUpdate,
    waitForJob: ctrl.waitForJob,
    getAsset,
  }
}

export function createMediaComfyUIPlugin(opts?: MediaComfyUIOptions): ProviderPlugin<MediaProvider> {
  const instance = createMediaComfyUIProvider(opts)
  return {
    id: MEDIA_COMFYUI_ID,
    name: 'ComfyUI 媒体',
    kind: 'provider',
    providerType: 'media',
    enabled: true,
    description:
      '调用本地 ComfyUI 工作流生成图片与视频。未配置模板时自动用内置 MiniMax H3 工作流搭建，支持首帧/尾帧文生视频。可按能力分别配置「文生图 / 参考生图 / 文生视频 / 参考生视频 / 首尾帧视频」模板，未配置时回退到通用视频模板（模板中用 {image}、{image_link}、{last_frame}、{last_frame_link} 占位符接线）。',
    capabilities: instance.capabilities,
    configFields: [
      'baseUrl',
      'workflowTemplateId',
      'img2imgWorkflowTemplateId',
      'textVideoWorkflowTemplateId',
      'imageVideoWorkflowTemplateId',
      'firstLastFrameWorkflowTemplateId',
    ],
    instance,
  }
}
