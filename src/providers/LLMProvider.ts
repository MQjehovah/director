export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelOption {
  id: string
  name: string
}

export interface LLMProvider {
  id: string
  name: string
  models: ModelOption[]
  chat(messages: ChatMessage[]): AsyncIterable<string>
  complete(prompt: string, params?: Record<string, unknown>): Promise<string>
}
