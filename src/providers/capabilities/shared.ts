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

  function setJob(job: JobInput): void {
    const parsed = JobSchema.parse(job)
    jobs.set(parsed.id, parsed)
    emit(parsed)
  }

  function patchJob(id: string, patch: Partial<Job>): void {
    const current = jobs.get(id)
    if (!current) throw new Error(`job not found: ${id}`)
    setJob({ ...current, ...patch })
  }

  function reportProgress(id: string, p: number): void {
    patchJob(id, { progress: p })
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
    startPoller,
    stopPoller,
  }
}
