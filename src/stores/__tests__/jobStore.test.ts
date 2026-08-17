import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJobStore } from '../jobStore'

describe('job store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
  it('adds job, updates progress, marks done', () => {
    const s = useJobStore()
    s.addJob({ id: 'j1', type: 'text2image', status: 'running', progress: 0 })
    s.updateProgress('j1', 50)
    expect(s.jobs[0].progress).toBe(50)
    s.markDone('j1', { assetIds: ['a1'] })
    expect(s.jobs[0].status).toBe('done')
  })
  it('tracks jobs by shot', () => {
    const s = useJobStore()
    s.addJob({ id: 'j2', type: 'image2video', status: 'queued', progress: 0, shotRef: 's1' })
    expect(s.jobsForShot('s1')).toHaveLength(1)
  })
  it('marks failed and canceled jobs', () => {
    const s = useJobStore()
    s.addJob({ id: 'j3', type: 'text2image' })
    s.markFailed('j3', 'boom')
    expect(s.jobs[0].status).toBe('failed')
    s.addJob({ id: 'j4', type: 'text2image' })
    s.markCanceled('j4')
    expect(s.jobs[1].status).toBe('canceled')
  })
  it('removes and looks up jobs', () => {
    const s = useJobStore()
    s.addJob({ id: 'j5', type: 'tts' })
    expect(s.getJob('j5')).toBeDefined()
    s.removeJob('j5')
    expect(s.getJob('j5')).toBeUndefined()
  })
  it('applies schema defaults when adding', () => {
    const s = useJobStore()
    s.addJob({ id: 'j6', type: 'text2image' })
    expect(s.jobs[0].progress).toBe(0)
    expect(s.jobs[0].status).toBe('queued')
  })
})
