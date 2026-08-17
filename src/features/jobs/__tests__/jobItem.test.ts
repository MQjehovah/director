import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import JobItem from '../JobItem.vue'
import JobDrawer from '../JobDrawer.vue'
import { useJobStore } from '../../../stores/jobStore'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { usePluginStore } from '../../../stores/pluginStore'
import { useShotActions } from '../../storyboard/useShotActions'
import { PluginRegistry } from '../../../core'
import { createMediaMockPlugin } from '../../../plugins/providers'

function initMedia(delayMs = 30): void {
  const registry = new PluginRegistry()
  registry.register(createMediaMockPlugin({ delayMs }))
  usePluginStore().init(registry)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('job item', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders progress and status', () => {
    const store = useJobStore()
    store.addJob({ id: 'j1', type: 'text2image', status: 'running', progress: 40 })
    const w = mount(JobItem, { props: { jobId: 'j1' } })
    expect(w.text()).toContain('40%')
    expect(w.text()).toContain('生成中')
  })

  it('renders done, failed and canceled badges', () => {
    const store = useJobStore()
    store.addJob({ id: 'd1', type: 'tts', status: 'done' })
    store.addJob({ id: 'f1', type: 'text2image', status: 'failed' })
    store.addJob({ id: 'c1', type: 'text2image', status: 'canceled' })
    expect(mount(JobItem, { props: { jobId: 'd1' } }).text()).toContain('已完成')
    expect(mount(JobItem, { props: { jobId: 'f1' } }).text()).toContain('失败')
    expect(mount(JobItem, { props: { jobId: 'c1' } }).text()).toContain('已取消')
  })

  it('renders a shot link when shotRef is present and emits locate on click', async () => {
    const storyboard = useStoryboardStore()
    const shot = storyboard.addShot({ shotType: 'image', prompt: '一只黑猫' })
    const store = useJobStore()
    store.addJob({
      id: 'j1',
      type: 'text2image',
      status: 'running',
      progress: 10,
      shotRef: shot.id,
    })
    const w = mount(JobItem, { props: { jobId: 'j1' } })
    expect(w.get('[data-test="job-shot-link"]').text()).toContain('镜头')
    await w.get('[data-test="job-shot-link"]').trigger('click')
    expect(w.emitted('locate')?.[0]?.[0]).toBe(shot.id)
  })

  it('cancels a running job via the media provider', async () => {
    initMedia(5000)
    const storyboard = useStoryboardStore()
    const jobs = useJobStore()
    const shot = storyboard.addShot({ shotType: 'image', prompt: '一只黑猫' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.status).toBe('running')
    const w = mount(JobItem, { props: { jobId: job?.id ?? '' } })
    await w.get('[data-test="job-cancel"]').trigger('click')
    await flushPromises()
    expect(jobs.getJob(job?.id ?? '')?.status).toBe('canceled')
  })

  it('retries a failed job by regenerating for its shot', async () => {
    initMedia()
    const storyboard = useStoryboardStore()
    const jobs = useJobStore()
    const shot = storyboard.addShot({ shotType: 'image', prompt: '一只黑猫' })
    jobs.addJob({
      id: 'old',
      type: 'text2image',
      status: 'failed',
      progress: 20,
      shotRef: shot.id,
      pluginId: 'media-mock',
    })
    const w = mount(JobItem, { props: { jobId: 'old' } })
    await w.get('[data-test="job-retry"]').trigger('click')
    await flushPromises()
    expect(jobs.getJob('old')).toBeUndefined()
    expect(jobs.jobs).toHaveLength(1)
    expect(jobs.jobs[0].status).toBe('running')
    await wait(100)
    expect(jobs.jobs[0].status).toBe('done')
    expect(storyboard.shotById(shot.id)?.mediaAssets).toHaveLength(1)
  })

  it('keeps the failed job visible when retry has no media provider', async () => {
    const storyboard = useStoryboardStore()
    const jobs = useJobStore()
    const shot = storyboard.addShot({ shotType: 'image' })
    jobs.addJob({ id: 'old', type: 'text2image', status: 'failed', shotRef: shot.id })
    const w = mount(JobItem, { props: { jobId: 'old' } })
    await w.get('[data-test="job-retry"]').trigger('click')
    await flushPromises()
    expect(jobs.getJob('old')?.status).toBe('failed')
    expect(jobs.jobs).toHaveLength(1)
  })

  it('cancels a running job via the owning plugin id', async () => {
    initMedia(5000)
    const storyboard = useStoryboardStore()
    const jobs = useJobStore()
    const shot = storyboard.addShot({ shotType: 'image', prompt: '一只黑猫' })
    const job = await useShotActions().generateMedia(shot.id)
    expect(job?.pluginId).toBe('media-mock')
    const w = mount(JobItem, { props: { jobId: job?.id ?? '' } })
    await w.get('[data-test="job-cancel"]').trigger('click')
    await flushPromises()
    expect(jobs.getJob(job?.id ?? '')?.status).toBe('canceled')
  })

  it('removes the job from the queue', async () => {
    const store = useJobStore()
    store.addJob({ id: 'j1', type: 'text2image', status: 'done' })
    const w = mount(JobItem, { props: { jobId: 'j1' } })
    await w.get('[data-test="job-remove"]').trigger('click')
    expect(store.getJob('j1')).toBeUndefined()
  })
})

describe('job drawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders nothing when closed', () => {
    const w = mount(JobDrawer, { props: { open: false } })
    expect(w.text()).toBe('')
  })

  it('shows an empty state when there are no jobs', () => {
    const w = mount(JobDrawer, { props: { open: true } })
    expect(w.get('[data-test="jobs-empty"]')).toBeTruthy()
  })

  it('renders the job list with a summary of status counts', () => {
    const store = useJobStore()
    store.addJob({ id: 'r1', type: 'text2image', status: 'running', progress: 30 })
    store.addJob({ id: 'd1', type: 'tts', status: 'done' })
    store.addJob({ id: 'f1', type: 'text2image', status: 'failed' })
    const w = mount(JobDrawer, { props: { open: true } })
    expect(w.findAll('[data-test="job-item"]')).toHaveLength(3)
    const summary = w.get('[data-test="jobs-summary"]').text()
    expect(summary).toContain('1 生成中')
    expect(summary).toContain('1 已完成')
    expect(summary).toContain('1 失败')
  })

  it('forwards locate events from job items', async () => {
    const storyboard = useStoryboardStore()
    const shot = storyboard.addShot({ shotType: 'image' })
    const store = useJobStore()
    store.addJob({ id: 'j1', type: 'text2image', status: 'done', shotRef: shot.id })
    const w = mount(JobDrawer, { props: { open: true } })
    await w.get('[data-test="job-shot-link"]').trigger('click')
    expect(w.emitted('locate')?.[0]?.[0]).toBe(shot.id)
  })
})
