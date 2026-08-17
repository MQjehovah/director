import { describe, it, expect } from 'vitest'
import { createMediaMockProvider } from '../media-mock'
import { createLLMMockProvider } from '../llm-mock'

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
  it('llm mock streams a reply', async () => {
    const p = createLLMMockProvider()
    let text = ''
    for await (const chunk of p.chat([{ role: 'user', content: 'hi' }])) text += chunk
    expect(text.length).toBeGreaterThan(0)
  })
})
