import { describe, it, expect } from 'vitest'
import { createMediaMockProvider } from '../media-mock'
import { createLLMMockProvider } from '../llm-mock'
import { createTTSSyncMock } from '../tts-mock'

describe('mock providers', () => {
  it('media mock returns a job that completes', async () => {
    const p = createMediaMockProvider()
    const job = await p.generateImage({ prompt: 'x', width: 512, height: 512, seed: 1 })
    expect(job.type).toBe('text2image')
    expect(job.status).toBe('running')
    const done = await p.waitForJob(job.id)
    expect(done.status).toBe('done')
    expect(done.result?.assetIds).toHaveLength(1)
  })
  it('media mock exposes generated asset for display', async () => {
    const p = createMediaMockProvider()
    const job = await p.generateImage({ prompt: 'x' })
    const done = await p.waitForJob(job.id)
    const assetId = done.result!.assetIds![0]
    const asset = await p.getAsset(assetId)
    expect(asset?.kind).toBe('image')
    expect(asset?.url).toContain('data:image/svg+xml')
  })
  it('media mock supports text2video capability', async () => {
    const p = createMediaMockProvider()
    expect(p.capabilities.text2video).toBe(true)
    const job = await p.generateVideo({ prompt: 'x' })
    expect(job.type).toBe('text2video')
    const done = await p.waitForJob(job.id)
    expect(done.status).toBe('done')
  })
  it('media mock cancels a running job', async () => {
    const p = createMediaMockProvider({ delayMs: 5000 })
    const job = await p.generateImage({ prompt: 'x' })
    const canceled = await p.cancelJob(job.id)
    expect(canceled.status).toBe('canceled')
    const now = await p.getJob(job.id)
    expect(now.status).toBe('canceled')
  })
  it('media mock notifies job updates on subscribe', async () => {
    const p = createMediaMockProvider()
    const seen: string[] = []
    const off = p.onJobUpdate((job) => seen.push(job.status))
    const job = await p.generateImage({ prompt: 'x' })
    await p.waitForJob(job.id)
    off()
    expect(seen).toContain('done')
  })
  it('llm mock streams a reply', async () => {
    const p = createLLMMockProvider()
    let text = ''
    for await (const chunk of p.chat([{ role: 'user', content: 'hi' }])) text += chunk
    expect(text.length).toBeGreaterThan(0)
  })
  it('tts mock completes a synthesis job with audio asset', async () => {
    const p = createTTSSyncMock()
    const job = await p.synthesize('你好世界', 'zh-female')
    expect(job.status).toBe('running')
    const done = await p.waitForJob(job.id)
    expect(done.status).toBe('done')
    const asset = await p.getAsset(done.result!.assetIds![0])
    expect(asset?.kind).toBe('audio')
  })
})
