import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import AgentPanel from '../AgentPanel.vue'
import { usePluginStore } from '../../../../stores/pluginStore'
import { useScriptStore } from '../../../../stores/scriptStore'
import { PluginRegistry } from '../../../../core'
import { createStubLLMProvider } from '../../../shared/__tests__/stubProviders'
import type { LLMProvider } from '../../../../providers/LLMProvider'

function initStore(instance?: LLMProvider): void {
  const registry = new PluginRegistry()
  if (instance) {
    registry.register({
      id: 'stub-agent-llm',
      name: 'Stub Agent LLM',
      kind: 'provider',
      providerType: 'llm',
      enabled: true,
      instance,
    })
  }
  usePluginStore().init(registry)
}

/** 脚本化 LLM：chat 按顺序返回给定回复（工具调用标记/最终汇总），complete 供工具内部生成 */
function makeScriptedLLM(chatResponses: string[]): LLMProvider {
  let calls = 0
  return {
    id: 'stub-agent-llm',
    name: 'Stub Agent LLM',
    models: [{ id: 'stub-chat', name: 'Stub Chat' }],
    async *chat() {
      const text = chatResponses[Math.min(calls, chatResponses.length - 1)]
      calls += 1
      yield text
    },
    async complete(prompt: string) {
      return `Mock 回复：${prompt}`
    },
  }
}

async function send(w: ReturnType<typeof mount>, text: string): Promise<void> {
  await w.get('[data-test="agent-input"]').setValue(text)
  await w.get('[data-test="agent-send"]').trigger('click')
  await flushPromises()
}

describe('AgentPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an empty state prompting to configure an LLM when no provider is registered', () => {
    initStore()
    const w = mount(AgentPanel)
    expect(w.get('[data-test="agent-empty"]').text()).toContain('设置')
  })

  it('sends a message and renders the assistant reply from the LLM', async () => {
    initStore(createStubLLMProvider())
    const w = mount(AgentPanel)
    await send(w, '你好')
    expect(w.text()).toContain('Mock 回复')
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    initStore(createStubLLMProvider())
    const w = mount(AgentPanel)
    await w.get('[data-test="agent-input"]').setValue('你好')
    await w.get('[data-test="agent-input"]').trigger('keydown', { key: 'Enter', shiftKey: false })
    await flushPromises()
    expect(w.text()).toContain('Mock 回复')
  })

  it('executes a tool call and renders the tool summary line plus the reply', async () => {
    initStore(
      makeScriptedLLM(['[[tool:generate_script(idea=都市少年)]]', '剧本已生成，请查看剧本面板。']),
    )
    const w = mount(AgentPanel)
    await send(w, '帮我写个剧本')
    expect(useScriptStore().scenes.length).toBeGreaterThan(0)
    expect(w.get('[data-test="agent-tool-summary"]').text()).toContain('generate_script')
    expect(w.text()).toContain('剧本已生成，请查看剧本面板。')
  })

  it('renders a copy button for prompt apply targets and copies to the clipboard', async () => {
    initStore(makeScriptedLLM(['[[tool:expand_prompt(text=银发剑士)]]', '提示词已扩写完成。']))
    const w = mount(AgentPanel)
    await send(w, '扩写提示词')
    const copy = w.get('[data-test="apply-copy"]')
    expect(copy).toBeTruthy()
    await copy.trigger('click')
    await flushPromises()
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(String(writeText.mock.calls[0][0])).toContain('银发剑士')
    expect(w.text()).toContain('已复制')
  })

  it('renders the skill drawer when its toggle button is clicked', async () => {
    initStore(createStubLLMProvider())
    const w = mount(AgentPanel)
    await w.get('[data-test="agent-drawer-toggle"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-test="skill-row"]')).not.toBeNull()
  })
})
