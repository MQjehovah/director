import { describe, it, expect } from 'vitest'
import { createAgent } from '../agent'
import type { AgentTool, AgentToolResult } from '../types'
import type { ChatMessage } from '../../../../providers/LLMProvider'

interface StubLLM {
  chat: (messages: ChatMessage[]) => AsyncIterable<string>
  callCount: () => number
  received: ChatMessage[][]
}

function makeStubLLM(responses: string[]): StubLLM {
  let calls = 0
  const received: ChatMessage[][] = []
  return {
    chat: async function* (messages: ChatMessage[]) {
      received.push(messages)
      const text = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      for (let i = 0; i < text.length; i += 3) {
        yield text.slice(i, i + 3)
      }
    },
    callCount: () => calls,
    received,
  }
}

interface RecordingTool extends AgentTool {
  runs: Record<string, string>[]
}

function makeRecordingTool(name: string, result?: Partial<AgentToolResult>): RecordingTool {
  const runs: Record<string, string>[] = []
  return {
    name,
    description: `测试工具 ${name}`,
    async run(args) {
      runs.push(args)
      return { name, ok: true, summary: `已执行 ${name}`, ...result }
    },
    runs,
  }
}

describe('createAgent', () => {
  it('runs tools then produces a final summary', async () => {
    const llm = makeStubLLM([
      '我来生成剧本。[[tool:generate_script(idea=都市少年)]]',
      '剧本已生成，请查看剧本面板。',
    ])
    const generate = makeRecordingTool('generate_script')
    const agent = createAgent({ llm, tools: [generate], systemPrompt: '你是导演助手' })
    const result = await agent.run('帮我写个剧本')

    expect(llm.callCount()).toBe(2)
    expect(llm.received[0][0].role).toBe('system')
    expect(llm.received[0][0].content).toContain('generate_script')
    const lastOfSecondCall = llm.received[1][llm.received[1].length - 1]
    expect(lastOfSecondCall.role).toBe('user')
    expect(lastOfSecondCall.content).toContain('工具 generate_script 结果')

    expect(result.assistantText).toBe('剧本已生成，请查看剧本面板。')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('generate_script')
    expect(result.toolCalls[0].args).toEqual({ idea: '都市少年' })
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].ok).toBe(true)
    expect(result.toolResults[0].summary).toBe('已执行 generate_script')
    expect(generate.runs).toHaveLength(1)
    expect(generate.runs[0]).toEqual({ idea: '都市少年' })
  })

  it('records tool failures (ok:false) and continues to the summary', async () => {
    const llm = makeStubLLM(['[[tool:boom(x=1)]]', '遇到了问题，但我会继续。'])
    const boom: AgentTool = {
      name: 'boom',
      description: '总是失败',
      async run() {
        return { name: 'boom', ok: false, summary: '执行失败：模拟错误' }
      },
    }
    const agent = createAgent({ llm, tools: [boom] })
    const result = await agent.run('执行吧')

    expect(result.assistantText).toBe('遇到了问题，但我会继续。')
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].ok).toBe(false)
    expect(result.toolResults[0].summary).toContain('模拟错误')
  })

  it('does not crash when a tool throws', async () => {
    const llm = makeStubLLM(['[[tool:crash(x=1)]]', '收到。'])
    const crash: AgentTool = {
      name: 'crash',
      description: '抛异常',
      async run() {
        throw new Error('boom!')
      },
    }
    const agent = createAgent({ llm, tools: [crash] })
    const result = await agent.run('跑一下')

    expect(result.assistantText).toBe('收到。')
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].ok).toBe(false)
    expect(result.toolResults[0].summary).toContain('boom!')
  })

  it('reports unknown tools without crashing', async () => {
    const llm = makeStubLLM(['[[tool:missing_tool(a=1)]]', '没有这个工具。'])
    const agent = createAgent({ llm, tools: [] })
    const result = await agent.run('调用缺失工具')

    expect(result.assistantText).toBe('没有这个工具。')
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].ok).toBe(false)
    expect(result.toolResults[0].summary).toContain('未知工具')
  })

  it('respects the maxToolCalls cap and terminates the loop', async () => {
    const llm = makeStubLLM(['[[tool:loop(x=1)]]'])
    const loop = makeRecordingTool('loop')
    const agent = createAgent({ llm, tools: [loop], opts: { maxToolCalls: 2 } })
    const result = await agent.run('一直循环吧')

    const executed = result.toolResults.filter((r) => r.ok)
    const skipped = result.toolResults.filter((r) => !r.ok)
    expect(executed).toHaveLength(2)
    expect(skipped.length).toBeGreaterThan(0)
    expect(result.toolCalls).toHaveLength(3)
    expect(result.toolResults).toHaveLength(3)
    expect(loop.runs).toHaveLength(2)
  })

  it('builds history across turns and reset clears it', async () => {
    const llm = makeStubLLM(['第一次回复', '第二次回复'])
    const agent = createAgent({ llm })
    await agent.run('你好')
    await agent.run('再聊')

    const history = agent.getHistory()
    expect(history).toHaveLength(4)
    expect(history[0]).toEqual({ role: 'user', content: '你好' })
    expect(history[1]).toEqual({ role: 'assistant', content: '第一次回复' })
    expect(history[2]).toEqual({ role: 'user', content: '再聊' })
    expect(history[3]).toEqual({ role: 'assistant', content: '第二次回复' })

    agent.reset()
    expect(agent.getHistory()).toHaveLength(0)
  })

  it('trims history to maxHistory messages', async () => {
    const llm = makeStubLLM(['r1', 'r2', 'r3', 'r4'])
    const agent = createAgent({ llm, opts: { maxHistory: 2 } })
    for (const m of ['a', 'b', 'c']) {
      await agent.run(m)
    }
    expect(agent.getHistory()).toHaveLength(2)
    expect(agent.getHistory()[0]).toEqual({ role: 'user', content: 'c' })
    expect(agent.getHistory()[1]).toEqual({ role: 'assistant', content: 'r3' })
  })

  it('setTools and setSystemPrompt affect subsequent turns', async () => {
    const llm = makeStubLLM(['[[tool:alpha(x=1)]]', 'OK'])
    const alpha = makeRecordingTool('alpha')
    const agent = createAgent({ llm, systemPrompt: '旧提示' })
    agent.setSystemPrompt('新提示')
    agent.setTools([alpha])
    const result = await agent.run('执行')

    expect(llm.received[0][0].content).toContain('新提示')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('alpha')
    expect(alpha.runs).toHaveLength(1)
  })
})
