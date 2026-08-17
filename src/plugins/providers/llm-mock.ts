import type { ProviderPlugin } from '../../core/plugin/types'
import type { ChatMessage, LLMProvider } from '../../providers/LLMProvider'

export interface LLMMockOptions {
  replyText?: string
  modelId?: string
  streamChunkSize?: number
}

export interface LLMMockProvider extends LLMProvider {
  replyText: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createLLMMockProvider(opts: LLMMockOptions = {}): LLMMockProvider {
  const replyText = opts.replyText ?? '你好！这是来自 Mock LLM 的流式回复。'
  const modelId = opts.modelId ?? 'mock-chat'
  const streamChunkSize = opts.streamChunkSize ?? 5

  async function* chat(_messages: ChatMessage[]): AsyncGenerator<string> {
    for (let i = 0; i < replyText.length; i += streamChunkSize) {
      await sleep(8)
      yield replyText.slice(i, i + streamChunkSize)
    }
  }

  async function complete(prompt: string): Promise<string> {
    return `Mock 回复：${prompt}`
  }

  return {
    id: 'llm-mock',
    name: 'Mock LLM',
    models: [{ id: modelId, name: 'Mock Chat' }],
    chat,
    complete,
    replyText,
  }
}

export function createLLMMockPlugin(opts?: LLMMockOptions): ProviderPlugin<LLMProvider> {
  const instance = createLLMMockProvider(opts)
  return {
    id: 'llm-mock',
    name: 'Mock LLM',
    kind: 'provider',
    providerType: 'llm',
    enabled: true,
    instance,
  }
}
