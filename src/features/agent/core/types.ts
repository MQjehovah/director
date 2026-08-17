export interface AgentMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AgentToolCall {
  name: string
  args: Record<string, string>
  raw: string
}

export type AgentApplyTargetKind = 'script' | 'prompt' | 'portrait' | 'shot' | 'workflow'

export interface AgentApplyTarget {
  kind: AgentApplyTargetKind
  id?: string
  text?: string
}

export interface AgentToolResult {
  name: string
  ok: boolean
  summary: string
  applyTarget?: AgentApplyTarget
}

export interface AgentTool {
  name: string
  description: string
  run(args: Record<string, string>): Promise<AgentToolResult>
}

export interface AgentTurnResult {
  userMessage: string
  assistantText: string
  toolCalls: AgentToolCall[]
  toolResults: AgentToolResult[]
}

export interface AgentOptions {
  maxToolCalls?: number
  maxHistory?: number
  systemPromptExtra?: string
}
