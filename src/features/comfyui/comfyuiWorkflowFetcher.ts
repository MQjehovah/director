import type { ObjectInfoNodeDef } from './workflowGraphConverter'

export interface RemoteWorkflowItem {
  id: string
  name: string
  source: 'api' | 'file'
  ref: string
  updatedAt?: string
}

export type WorkflowListMode = 'api' | 'userdata' | 'none'

export interface WorkflowListResult {
  ok: boolean
  mode: WorkflowListMode
  items: RemoteWorkflowItem[]
  error?: string
}

export interface WorkflowContentResult {
  ok: boolean
  workflowJson?: unknown
  error?: string
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function headersWithApiKey(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  return headers
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 拉取 ComfyUI 中保存的工作流列表：
 * 1. 新版 API：GET /api/workflows（返回 { data: [...] }）；
 * 2. 旧版兜底：GET /userdata?dir=workflows（返回文件路径数组或 { 路径: {content,...} }）。
 */
export async function listComfyUIWorkflows(
  baseUrl: string,
  apiKey?: string,
): Promise<WorkflowListResult> {
  const url = cleanBaseUrl(baseUrl)

  // 新版工作流 API
  try {
    const res = await fetch(`${url}/api/workflows?limit=100&sort=update_time&order=desc`, {
      headers: headersWithApiKey(apiKey),
    })
    if (res.ok) {
      const body = (await res.json()) as { data?: unknown }
      if (Array.isArray(body.data) && body.data.length >= 0) {
        const items: RemoteWorkflowItem[] = body.data
          .filter(isRecord)
          .filter((w) => typeof w.id === 'string' && typeof w.name === 'string')
          .map((w) => ({
            id: String(w.id),
            name: String(w.name),
            source: 'api' as const,
            ref: String(w.id),
            updatedAt:
              typeof w.updated_at === 'string' ? String(w.updated_at) : undefined,
          }))
        return { ok: true, mode: 'api', items }
      }
    }
  } catch {
    // 网络错误继续尝试旧接口，最终错误信息里再说明
  }

  // 旧版 /userdata 兜底
  try {
    const res = await fetch(
      `${url}/userdata?dir=workflows&recurse=true&full_info=true`,
      { headers: headersWithApiKey(apiKey) },
    )
    if (res.ok) {
      const body: unknown = await res.json()
      const items: RemoteWorkflowItem[] = []
      if (Array.isArray(body)) {
        for (const entry of body) {
          if (typeof entry === 'string' && entry.toLowerCase().endsWith('.json')) {
            items.push({
              id: entry,
              name: entry.split('/').pop()?.replace(/\.json$/i, '') ?? entry,
              source: 'file',
              ref: entry,
            })
          } else if (isRecord(entry) && typeof entry.path === 'string') {
            const path = String(entry.path)
            if (path.toLowerCase().endsWith('.json')) {
              items.push({
                id: path,
                name: path.split('/').pop()?.replace(/\.json$/i, '') ?? path,
                source: 'file',
                ref: path,
              })
            }
          }
        }
      } else if (isRecord(body)) {
        // 更旧版本：{ "workflows/name.json": { modified, content } }
        for (const [path, info] of Object.entries(body)) {
          if (!path.toLowerCase().endsWith('.json')) continue
          items.push({
            id: path,
            name: path.split('/').pop()?.replace(/\.json$/i, '') ?? path,
            source: 'file',
            ref: path,
            updatedAt: isRecord(info) && typeof info.modified === 'number'
              ? new Date((info.modified as number) * 1000).toISOString()
              : undefined,
          })
        }
      }
      if (items.length > 0) return { ok: true, mode: 'userdata', items }
    }
  } catch {
    // fall through
  }

  return {
    ok: false,
    mode: 'none',
    items: [],
    error: `无法从 ${url} 获取工作流：请确认地址正确、ComfyUI 已启动，且当前用户保存过工作流。`,
  }
}

/** 拉取单个工作流的内容（UI/前端格式或 API 格式，均原样返回） */
export async function fetchComfyUIWorkflowContent(
  baseUrl: string,
  item: RemoteWorkflowItem,
  apiKey?: string,
): Promise<WorkflowContentResult> {
  const url = cleanBaseUrl(baseUrl)
  try {
    if (item.source === 'api') {
      const res = await fetch(`${url}/api/workflows/${encodeURIComponent(item.ref)}/content`, {
        headers: headersWithApiKey(apiKey),
      })
      if (!res.ok) {
        return { ok: false, error: `获取工作流内容失败（${res.status}）` }
      }
      const body = (await res.json()) as { workflow_json?: unknown }
      if (body.workflow_json === undefined) {
        return { ok: false, error: 'ComfyUI 未返回 workflow_json' }
      }
      return { ok: true, workflowJson: body.workflow_json }
    }

    const filePath = item.ref
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const res = await fetch(`${url}/userdata/${filePath}`, {
      headers: headersWithApiKey(apiKey),
    })
    if (!res.ok) {
      return { ok: false, error: `获取工作流文件失败（${res.status}）` }
    }
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: '工作流文件不是有效 JSON' }
    }
    // 兼容 { content: "..." } 包装
    if (isRecord(parsed) && typeof parsed.content === 'string') {
      try {
        parsed = JSON.parse(parsed.content)
      } catch {
        return { ok: false, error: '工作流文件内容不是有效 JSON' }
      }
    }
    return { ok: true, workflowJson: parsed }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const objectInfoCache = new Map<string, Record<string, ObjectInfoNodeDef>>()

/** 拉取节点定义（/object_info），用于把 widgets_values 映射为命名输入；结果按地址缓存 */
export async function fetchComfyUIObjectInfo(
  baseUrl: string,
  apiKey?: string,
): Promise<Record<string, ObjectInfoNodeDef>> {
  const url = cleanBaseUrl(baseUrl)
  const cached = objectInfoCache.get(url)
  if (cached) return cached
  const res = await fetch(`${url}/object_info`, { headers: headersWithApiKey(apiKey) })
  if (!res.ok) throw new Error(`获取 ComfyUI 节点定义失败（${res.status}）`)
  const body = (await res.json()) as Record<string, ObjectInfoNodeDef>
  objectInfoCache.set(url, body)
  return body
}
