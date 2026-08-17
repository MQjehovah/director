import { defineStore } from 'pinia'
import { ref } from 'vue'
import { JobSchema } from '../core/models'
import type { Job, JobResult } from '../core/models'

export type JobInput = Omit<Partial<Job>, 'id' | 'type'> & { id: string; type: string }

export const useJobStore = defineStore('job', () => {
  const jobs = ref<Job[]>([])

  function getJob(id: string): Job | undefined {
    return jobs.value.find((j) => j.id === id)
  }

  function replace(id: string, next: Job): void {
    jobs.value = jobs.value.map((j) => (j.id === id ? next : j))
  }

  function addJob(data: JobInput): Job {
    const job = JobSchema.parse({ ...data })
    jobs.value.push(job)
    return job
  }

  function updateJob(job: Job): void {
    const parsed = JobSchema.parse(job)
    replace(job.id, parsed)
  }

  function updateProgress(id: string, p: number): void {
    const job = getJob(id)
    if (!job) return
    replace(id, JobSchema.parse({ ...job, progress: p }))
  }

  function isActive(job: Job | undefined): job is Job {
    return !!job && (job.status === 'queued' || job.status === 'running')
  }

  function markDone(id: string, result?: JobResult): void {
    const job = getJob(id)
    if (!isActive(job)) return
    replace(
      id,
      JobSchema.parse({ ...job, status: 'done', progress: 100, ...(result ? { result } : {}) }),
    )
  }

  function markFailed(id: string, error?: string): void {
    const job = getJob(id)
    if (!isActive(job)) return
    const result = error ? { data: { error } } : undefined
    replace(id, JobSchema.parse({ ...job, status: 'failed', ...(result ? { result } : {}) }))
  }

  function markCanceled(id: string): void {
    const job = getJob(id)
    if (!isActive(job)) return
    replace(id, JobSchema.parse({ ...job, status: 'canceled' }))
  }

  function removeJob(id: string): void {
    jobs.value = jobs.value.filter((j) => j.id !== id)
  }

  function jobsForShot(shotRef: string): Job[] {
    return jobs.value.filter((j) => j.shotRef === shotRef)
  }

  return {
    jobs,
    addJob,
    updateJob,
    updateProgress,
    markDone,
    markFailed,
    markCanceled,
    removeJob,
    getJob,
    jobsForShot,
  }
})
