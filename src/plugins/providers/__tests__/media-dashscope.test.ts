import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMediaDashScopeProvider, MEDIA_DASHSCOPE_ID } from '../media-dashscope'
import { saveProviderConfig, clearProviderConfig } from '../../../features/settings/httpBackendConfig'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('media-dashscope provider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clearProviderConfig(MEDIA_DASHSCOPE_ID)
  })

  it('throws a clear error when apiKey is missing', async () => {
    const p = createMediaDashScopeProvider()
    await expect(p.generateImage({ prompt: '一只猫' })).rejects.toThrow('未配置')
  })

  it('creates a task, polls, and attaches the result url as an asset', async () => {
    saveProviderConfig(MEDIA_DASHSCOPE_ID, { apiKey: 'sk-test', model: 'wanx-v1' })
    const createCall = vi.fn().mockResolvedValue(
      jsonResponse({ output: { task_id: 't1', task_status: 'PENDING' } }),
    )
    const pollCall = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ output: { task_id: 't1', task_status: 'RUNNING' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          output: {
            task_id: 't1',
            task_status: 'SUCCEEDED',
            results: [{ url: 'https://dashscope-result-bj.oss.example.com/a.png' }],
          },
        }),
      )
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/image-synthesis')) return createCall(url, init)
      if (String(url).includes('/tasks/')) return pollCall(url)
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const p = createMediaDashScopeProvider({ pollIntervalMs: 10 })
    const job = await p.generateImage({ prompt: '银发剑士', negativePrompt: '模糊', seed: 42 })
    expect(job.id).toBe('t1')
    expect(job.status).toBe('queued')

    // 校验请求体
    const init = createCall.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-DashScope-Async']).toBe('enable')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('wanx-v1')
    expect(body.input.prompt).toBe('银发剑士')
    expect(body.input.negative_prompt).toBe('模糊')
    expect(body.parameters.seed).toBe(42)

    await vi.advanceTimersByTimeAsync(10)
    expect(pollCall).toHaveBeenCalled()
    expect((await p.getJob('t1')).status).toBe('running')
    await vi.advanceTimersByTimeAsync(10)
    const done = await p.getJob('t1')
    expect(done.status).toBe('done')
    const asset = await p.getAsset(done.result!.assetIds![0])
    expect(asset?.url).toBe('https://dashscope-result-bj.oss.example.com/a.png')
  })

  it('marks failed when the task status is FAILED', async () => {
    saveProviderConfig(MEDIA_DASHSCOPE_ID, { apiKey: 'sk-test' })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/image-synthesis')
          ? jsonResponse({ output: { task_id: 't2', task_status: 'PENDING' } })
          : jsonResponse({
              output: {
                task_id: 't2',
                task_status: 'FAILED',
                results: [{ message: '配额不足' }],
              },
            }),
      ),
    )
    const p = createMediaDashScopeProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    await vi.advanceTimersByTimeAsync(10)
    expect((await p.getJob('t2')).status).toBe('failed')
  })

  it('uses default model and task url when config omits them', async () => {
    saveProviderConfig(MEDIA_DASHSCOPE_ID, { apiKey: 'sk-test' })
    const createCall = vi.fn().mockResolvedValue(
      jsonResponse({ output: { task_id: 't3', task_status: 'PENDING' } }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        String(url).includes('/image-synthesis') ? createCall(url, init) : jsonResponse({}),
      ),
    )
    const p = createMediaDashScopeProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    const body = JSON.parse((createCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('wanx-v1')
  })

  it('cancelJob stops the poller and marks canceled', async () => {
    saveProviderConfig(MEDIA_DASHSCOPE_ID, { apiKey: 'sk-test' })
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ output: { task_id: 't4', task_status: 'PENDING' } })))
    const p = createMediaDashScopeProvider({ pollIntervalMs: 10 })
    await p.generateImage({ prompt: 'x' })
    const canceled = await p.cancelJob('t4')
    expect(canceled.status).toBe('canceled')
    const before = vi.mocked(fetch).mock.calls.length
    await vi.advanceTimersByTimeAsync(50)
    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
  })
})
