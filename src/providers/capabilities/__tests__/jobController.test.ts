import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '../../../core/models'
import { createJobController } from '../shared'

function makeJob(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    type: 'text2image',
    status: 'queued',
    progress: 0,
    params: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createJobController', () => {
  it('setJob stores the job and getJob returns it with zod defaults', async () => {
    const ctrl = createJobController()
    ctrl.setJob({ id: 'j1', type: 'text2image' })
    const job = await ctrl.getJob('j1')
    expect(job.id).toBe('j1')
    expect(job.status).toBe('queued')
    expect(job.progress).toBe(0)
    expect(job.params).toEqual({})
    expect(job.createdAt).toBeTruthy()
  })

  it('getJob throws for a missing job', async () => {
    const ctrl = createJobController()
    await expect(ctrl.getJob('missing')).rejects.toThrow('job not found')
  })

  it('onJobUpdate emits on setJob and unsubscribing stops emissions', () => {
    const ctrl = createJobController()
    const a = vi.fn()
    const b = vi.fn()
    const offA = ctrl.onJobUpdate(a)
    ctrl.onJobUpdate(b)
    ctrl.setJob(makeJob('j1'))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    ctrl.setJob(makeJob('j2'))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('patchJob merges the current job with the patch and applies zod parsing', async () => {
    const ctrl = createJobController()
    ctrl.setJob(makeJob('j1', { progress: 10, params: { prompt: 'cat' } }))
    ctrl.patchJob('j1', { status: 'running', progress: 50 })
    const job = await ctrl.getJob('j1')
    expect(job.status).toBe('running')
    expect(job.progress).toBe(50)
    expect(job.params).toEqual({ prompt: 'cat' })
  })

  it('patchJob throws when the job does not exist', () => {
    const ctrl = createJobController()
    expect(() => ctrl.patchJob('missing', { progress: 1 })).toThrow('job not found')
  })

  it('reportProgress updates progress and emits', async () => {
    const ctrl = createJobController()
    const seen: Job[] = []
    ctrl.onJobUpdate((j) => seen.push(j))
    ctrl.setJob(makeJob('j1'))
    ctrl.reportProgress('j1', 75)
    const job = await ctrl.getJob('j1')
    expect(job.progress).toBe(75)
    expect(seen[seen.length - 1].progress).toBe(75)
  })

  it('waitForJob resolves once the job is terminal', async () => {
    const ctrl = createJobController()
    ctrl.setJob(makeJob('j1', { status: 'done', progress: 100 }))
    const job = await ctrl.waitForJob('j1')
    expect(job.status).toBe('done')
  })

  it('waitForJob times out when the job never finishes', async () => {
    const ctrl = createJobController()
    ctrl.setJob(makeJob('j1', { status: 'running' }))
    await expect(ctrl.waitForJob('j1', 50)).rejects.toThrow('timed out')
  })

  it('cancelJob marks a running job canceled and stops its poller', async () => {
    vi.useFakeTimers()
    const ctrl = createJobController({ pollIntervalMs: 100 })
    const poll = vi.fn().mockResolvedValue(undefined)
    ctrl.setJob(makeJob('j1', { status: 'running', progress: 40 }))
    ctrl.startPoller('j1', poll)
    await vi.advanceTimersByTimeAsync(250)
    expect(poll).toHaveBeenCalled()
    const canceled = await ctrl.cancelJob('j1')
    expect(canceled.status).toBe('canceled')
    const callsAfterCancel = poll.mock.calls.length
    await vi.advanceTimersByTimeAsync(300)
    expect(poll.mock.calls.length).toBe(callsAfterCancel)
  })

  it('cancelJob is a no-op for a terminal job', async () => {
    const ctrl = createJobController()
    ctrl.setJob(makeJob('j1', { status: 'done', progress: 100 }))
    const job = await ctrl.cancelJob('j1')
    expect(job.status).toBe('done')
  })

  it('cancelJob throws for a missing job', async () => {
    const ctrl = createJobController()
    await expect(ctrl.cancelJob('missing')).rejects.toThrow('job not found')
  })

  it('startPoller guards against double-starting', async () => {
    vi.useFakeTimers()
    const ctrl = createJobController({ pollIntervalMs: 100 })
    const poll = vi.fn().mockResolvedValue(undefined)
    ctrl.startPoller('j1', poll)
    ctrl.startPoller('j1', poll)
    await vi.advanceTimersByTimeAsync(250)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('startPoller swallows poll errors and keeps polling', async () => {
    vi.useFakeTimers()
    const ctrl = createJobController({ pollIntervalMs: 100 })
    const poll = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    ctrl.startPoller('j1', poll)
    await vi.advanceTimersByTimeAsync(250)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('stopPoller clears the poller', async () => {
    vi.useFakeTimers()
    const ctrl = createJobController({ pollIntervalMs: 100 })
    const poll = vi.fn().mockResolvedValue(undefined)
    ctrl.startPoller('j1', poll)
    await vi.advanceTimersByTimeAsync(250)
    const calls = poll.mock.calls.length
    ctrl.stopPoller('j1')
    await vi.advanceTimersByTimeAsync(300)
    expect(poll.mock.calls.length).toBe(calls)
  })

  it('patchJob ignores writes after the job reaches a terminal state', async () => {
    const ctrl = createJobController()
    ctrl.setJob({ id: 'j1', type: 'text2image', status: 'running', progress: 20 })
    ctrl.patchJob('j1', { status: 'done', progress: 100, result: { assetIds: ['a1'] } })
    // 迟到的轮询响应试图把已完成任务改回 running
    ctrl.patchJob('j1', { status: 'running', progress: 50 })
    const job = await ctrl.getJob('j1')
    expect(job.status).toBe('done')
    expect(job.progress).toBe(100)
    expect(job.result?.assetIds).toEqual(['a1'])
  })

  it('patchJob ignores writes after cancel', async () => {
    const ctrl = createJobController()
    ctrl.setJob({ id: 'j1', type: 'text2image', status: 'running' })
    await ctrl.cancelJob('j1')
    ctrl.patchJob('j1', { status: 'done', progress: 100, result: { assetIds: ['a1'] } })
    expect((await ctrl.getJob('j1')).status).toBe('canceled')
  })

  it('isTerminal reports the terminal state', async () => {
    const ctrl = createJobController()
    ctrl.setJob({ id: 'j1', type: 'text2image', status: 'running' })
    expect(await ctrl.isTerminal('j1')).toBe(false)
    ctrl.setJob({ id: 'j2', type: 'text2image', status: 'done' })
    expect(await ctrl.isTerminal('j2')).toBe(true)
    expect(await ctrl.isTerminal('missing')).toBe(true)
  })

  it('fail marks the job failed with error and stops the poller', async () => {
    vi.useFakeTimers()
    const ctrl = createJobController({ pollIntervalMs: 100 })
    ctrl.setJob({ id: 'j1', type: 'text2image', status: 'running' })
    const poll = vi.fn().mockResolvedValue(undefined)
    ctrl.startPoller('j1', poll)
    ctrl.fail('j1', '出错了')
    const job = await ctrl.getJob('j1')
    expect(job.status).toBe('failed')
    expect(job.result?.data?.error).toBe('出错了')
    const calls = poll.mock.calls.length
    await vi.advanceTimersByTimeAsync(250)
    expect(poll.mock.calls.length).toBe(calls)
  })

  it('fail is a no-op after a terminal state', async () => {
    const ctrl = createJobController()
    ctrl.setJob({ id: 'j1', type: 'text2image', status: 'done' })
    ctrl.fail('j1', '不应覆盖')
    expect((await ctrl.getJob('j1')).status).toBe('done')
  })
})
