import type { LLMProvider } from '../../../providers/LLMProvider'
import { parseToolCalls } from './parser'
import type {
  AgentMessage,
  AgentOptions,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  AgentTurnResult,
} from './types'

const DEFAULT_SYSTEM_PROMPT = `你是「AI导演台」的 AI 导演助手，负责帮助用户完成剧本创作、分镜设计、角色设定、提示词生成等影视制作任务。

需要完成具体任务时，请使用工具调用标记，格式如下：
[[tool:工具名(参数1=值1, 参数2=值2)]]

规则：
- 参数之间用英文逗号分隔；如果值包含空格、逗号或括号等特殊字符，请用引号包裹，例如 style="<anime>"。
- 值中若含多层嵌套括号，必须整体用引号包裹，例如 prompt="call(min(1,2))"。
- 一条回复中可同时调用多个工具。
- 调用工具后，请根据工具返回的结果，用简洁的中文向用户总结。
- 如果无需调用工具，直接回复用户。`

function formatToolResults(results: AgentToolResult[]): string {
  return results.map((r) => `工具 ${r.name} 结果：${r.summary}`).join('\n')
}

export interface AgentEngine {
  run(userMessage: string): Promise<AgentTurnResult>
  reset(): void
  setTools(tools: AgentTool[]): void
  setSystemPrompt(prompt: string): void
  getHistory(): AgentMessage[]
}

export function createAgent(deps: {
  llm: Pick<LLMProvider, 'chat'>
  tools?: AgentTool[]
  systemPrompt?: string
  opts?: AgentOptions
}): AgentEngine {
  const maxToolCalls = deps.opts?.maxToolCalls ?? 5
  const maxHistory = deps.opts?.maxHistory ?? 20
  let basePrompt = deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  let tools: AgentTool[] = deps.tools ?? []
  let history: AgentMessage[] = []

  function buildSystemPrompt(): string {
    const toolLines =
      tools.length > 0
        ? tools.map((t) => `- ${t.name}：${t.description}`).join('\n')
        : '- 当前没有可用工具'
    const parts = [basePrompt, deps.opts?.systemPromptExtra, `可用工具：\n${toolLines}`]
    return parts.filter(Boolean).join('\n\n')
  }

  async function runTool(call: AgentToolCall): Promise<AgentToolResult> {
    const tool = tools.find((t) => t.name === call.name)
    if (!tool) {
      return { name: call.name, ok: false, summary: `未知工具：${call.name}` }
    }
    try {
      return await tool.run(call.args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { name: call.name, ok: false, summary: `工具 ${call.name} 执行出错：${message}` }
    }
  }

  async function run(userMessage: string): Promise<AgentTurnResult> {
    const toolCalls: AgentToolCall[] = []
    const toolResults: AgentToolResult[] = []
    // 先提交用户消息，避免中途 llm.chat 抛错时上下文丢失（重试不会从空历史开始）
    history = [...history, { role: 'user' as const, content: userMessage }].slice(-maxHistory)
    const messages: AgentMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...history.slice(-maxHistory),
    ]

    const maxIterations = maxToolCalls + 1
    let assistantText = ''
    for (let i = 0; i < maxIterations; i += 1) {
      const text = await accumulate(deps.llm, messages)
      const calls = parseToolCalls(text)
      if (calls.length === 0) {
        assistantText = text
        break
      }
      assistantText = text
      messages.push({ role: 'assistant', content: text })
      const remaining = maxToolCalls - toolCalls.length
      for (let c = 0; c < calls.length; c += 1) {
        const call = calls[c]
        toolCalls.push(call)
        toolResults.push(
          c < remaining ? await runTool(call) : { name: call.name, ok: false, summary: `已达到单轮最大工具调用数（${maxToolCalls}），工具 ${call.name} 已跳过` },
        )
      }
      messages.push({
        role: 'user',
        content: formatToolResults(toolResults.slice(-calls.length)),
      })
    }

    history = [...history, { role: 'assistant' as const, content: assistantText }].slice(-maxHistory)

    return { userMessage, assistantText, toolCalls, toolResults }
  }

  return {
    run,
    reset() {
      history = []
    },
    setTools(next: AgentTool[]) {
      tools = next
    },
    setSystemPrompt(prompt: string) {
      basePrompt = prompt
    },
    getHistory() {
      return [...history]
    },
  }
}

async function accumulate(
  llm: Pick<LLMProvider, 'chat'>,
  messages: AgentMessage[],
): Promise<string> {
  let text = ''
  for await (const chunk of llm.chat(messages)) {
    text += chunk
  }
  return text
}
