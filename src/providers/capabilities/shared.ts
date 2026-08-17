import { z } from 'zod'
import { JobSchema } from '../../core/models/job'
import type { Job } from '../../core/models/job'

export interface JobControllerOptions {
  pollIntervalMs?: number
}

/** 任务输入：可省略带默认值的字段，由 JobSchema 统一补齐默认值 */
type JobInput = z.input<typeof JobSchema>

export interface JobController {
  getJob(id: string): Promise<Job>
  onJobUpdate(cb: (job: Job) => void): () => void
  waitForJob(id: string, timeoutMs?: number): Promise<Job>
  cancelJob(id: string): Promise<Job>
  setJob(job: JobInput): void
  patchJob(id: string, patch: Partial<Job>): void
  reportProgress(id: string, p: number): void
  isTerminal(id: string): Promise<boolean>
  fail(id: string, message: string): void
  startPoller(id: string, poll: () => Promise<void>, intervalMs?: number): void
  stopPoller(id: string): void
}

export function createJobController(opts: JobControllerOptions = {}): JobController {
  const defaultIntervalMs = opts.pollIntervalMs ?? 1000

  const jobs = new Map<string, Job>()
  const listeners = new Set<(job: Job) => void>()
  const pollers = new Map<string, ReturnType<typeof setInterval>>()

  function emit(job: Job): void {
    for (const cb of listeners) cb(job)
  }

  async function getJob(id: string): Promise<Job> {
    const job = jobs.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    return job
  }

  function onJobUpdate(cb: (job: Job) => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  async function waitForJob(id: string, timeoutMs = 120000): Promise<Job> {
    const startedAt = Date.now()
    for (;;) {
      const job = await getJob(id)
      if (job.status !== 'queued' && job.status !== 'running') return job
      if (Date.now() - startedAt > timeoutMs) throw new Error(`waitForJob timed out: ${id}`)
      await new Promise((resolve) => setTimeout(resolve, defaultIntervalMs))
    }
  }

  async function cancelJob(id: string): Promise<Job> {
    const job = jobs.get(id)
    if (!job) throw new Error(`job not found: ${id}`)
    if (job.status === 'queued' || job.status === 'running') {
      stopPoller(id)
      patchJob(id, { status: 'canceled' })
    }
    const current = jobs.get(id)
    if (!current) throw new Error(`job not found: ${id}`)
    return current
  }

  const TERMINAL_STATUSES: ReadonlySet<Job['status']> = new Set(['done', 'failed', 'canceled'])

  /** 任务是否已到达终态 */
  function isTerminalStatus(status: Job['status']): boolean {
    return TERMINAL_STATUSES.has(status)
  }

  function setJob(job: JobInput): void {
    const parsed = JobSchema.parse(job)
    jobs.set(parsed.id, parsed)
    emit(parsed)
  }

  function patchJob(id: string, patch: Partial<Job>): void {
    const current = jobs.get(id)
    if (!current) throw new Error(`job not found: ${id}`)
    // 终态不变性：任务 done/failed/canceled 后忽略后续写入，
    // 防止迟到的轮询响应把已完成的（或已取消的）任务改回 running/done
    if (isTerminalStatus(current.status)) return
    // 固定 id：即使 patch 误带其他 id 也不会把任务复制到新 id
    setJob({ ...current, ...patch, id })
  }

  function reportProgress(id: string, p: number): void {
    patchJob(id, { progress: p })
  }

  async function isTerminal(id: string): Promise<boolean> {
    const job = jobs.get(id)
    return job ? isTerminalStatus(job.status) : true
  }

  /** 标记任务失败（若仍处非终态），附带错误信息 */
  function fail(id: string, message: string): void {
    const job = jobs.get(id)
    if (!job) return
    if (isTerminalStatus(job.status)) return
    stopPoller(id)
    patchJob(id, {
      status: 'failed',
      progress: 100,
      result: { data: { error: message } },
    })
  }

  function startPoller(id: string, poll: () => Promise<void>, intervalMs?: number): void {
    if (pollers.has(id)) return
    const interval = intervalMs ?? defaultIntervalMs
    const timer = setInterval(() => {
      try {
        Promise.resolve(poll()).catch(() => {})
      } catch {
        // swallow poll errors; a thrown poll must not become an unhandled error
      }
    }, interval)
    pollers.set(id, timer)
  }

  function stopPoller(id: string): void {
    const timer = pollers.get(id)
    if (timer) clearInterval(timer)
    pollers.delete(id)
  }

  return {
    getJob,
    onJobUpdate,
    waitForJob,
    cancelJob,
    setJob,
    patchJob,
    reportProgress,
    isTerminal,
    fail,
    startPoller,
    stopPoller,
  }
}
