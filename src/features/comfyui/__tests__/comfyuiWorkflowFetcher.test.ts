import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  listComfyUIWorkflows,
  fetchComfyUIWorkflowContent,
} from '../comfyuiWorkflowFetcher'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

describe('comfyuiWorkflowFetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists workflows via the new /api/workflows endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/api/workflows?')
          ? Promise.resolve(
              jsonResponse({
                data: [
                  { id: 'a1', name: '文生图', updated_at: '2026-01-01T00:00:00Z' },
                  { id: 'b2', name: '视频' },
                ],
              }),
            )
          : Promise.resolve(jsonResponse({})),
      ),
    )
    const result = await listComfyUIWorkflows('http://127.0.0.1:8188/')
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('api')
    expect(result.items.map((i) => i.name)).toEqual(['文生图', '视频'])
    expect(result.items[0].ref).toBe('a1')
  })

  it('falls back to /userdata directory listing when the new API is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url)
        if (u.includes('/api/workflows?')) {
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)
        }
        if (u.includes('/userdata?dir=workflows')) {
          return Promise.resolve(
            jsonResponse({
              'workflows/我的工作流.json': { modified: 1700000000 },
              'workflows/other.txt': { modified: 0 },
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
    const result = await listComfyUIWorkflows('http://127.0.0.1:8188')
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('userdata')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].name).toBe('我的工作流')
  })

  it('fetches workflow content for an API item', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).endsWith('/api/workflows/wf-1/content')
          ? Promise.resolve(jsonResponse({ workflow_json: { nodes: [] } }))
          : Promise.resolve(jsonResponse({})),
      ),
    )
    const result = await fetchComfyUIWorkflowContent('http://127.0.0.1:8188', {
      id: 'wf-1',
      name: 'x',
      source: 'api',
      ref: 'wf-1',
    })
    expect(result.ok).toBe(true)
    expect(result.workflowJson).toEqual({ nodes: [] })
  })

  it('fetches a userdata workflow file and unwraps the content field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url)
        if (u.includes('/api/workflows?')) {
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)
        }
        if (u.includes('/userdata?dir=workflows')) {
          // 该接口返回相对 workflows 目录的路径
          return Promise.resolve(jsonResponse(['a.json']))
        }
        if (u.includes('/userdata/workflows%2Fa.json')) {
          return Promise.resolve(jsonResponse(JSON.stringify({ nodes: [1] })))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
    const list = await listComfyUIWorkflows('http://127.0.0.1:8188')
    expect(list.items[0].ref).toBe('workflows/a.json')
    const content = await fetchComfyUIWorkflowContent('http://127.0.0.1:8188', list.items[0])
    expect(content.ok).toBe(true)
    expect(content.workflowJson).toEqual({ nodes: [1] })
  })

  it('uses workflow content embedded in the legacy /userdata list response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url)
        if (u.includes('/api/workflows?')) {
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)
        }
        if (u.includes('/userdata?dir=workflows')) {
          return Promise.resolve(
            jsonResponse({
              'workflows/old.json': {
                modified: 1700000000,
                content: JSON.stringify({ nodes: [9] }),
              },
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
    const list = await listComfyUIWorkflows('http://127.0.0.1:8188')
    const content = await fetchComfyUIWorkflowContent('http://127.0.0.1:8188', list.items[0])
    expect(content.ok).toBe(true)
    expect(content.workflowJson).toEqual({ nodes: [9] })
  })
})
