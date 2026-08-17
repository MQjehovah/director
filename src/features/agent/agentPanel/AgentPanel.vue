<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Badge, Button, Textarea } from '../../../components/ui'
import { usePluginStore } from '../../../stores/pluginStore'
import { createAgent } from '../core/agent'
import type { AgentEngine } from '../core/agent'
import type { AgentApplyTarget, AgentApplyTargetKind } from '../core/types'
import { createProjectTools } from '../skills/projectTools'
import { listSkills } from '../skills/skillStore'
import { buildSkillsContext } from '../skills/skillDescriptions'
import type { LLMProvider } from '../../../providers/LLMProvider'
import SkillDrawer from './SkillDrawer.vue'

interface PanelMessage {
  role: 'user' | 'assistant'
  text: string
  toolSummary?: string[]
  applyTargets?: AgentApplyTarget[]
}

const pluginStore = usePluginStore()
const llmProvider = computed(() => pluginStore.llmProvider)

// LLM 以 ref 持有并在 watch 中跟随 pluginStore.llmProvider 更新。Agent 引擎首次发送时
// 惰性创建一次；引擎的 chat 通过闭包读取 llmRef 的当前值，因此切换 Provider 无需重建
// 引擎，对话历史（engine.getHistory）得以跨轮次保留。
const llmRef = ref<Pick<LLMProvider, 'chat'> | undefined>(pluginStore.llmProvider)
watch(
  () => pluginStore.llmProvider,
  (next) => {
    llmRef.value = next
  },
)

const messages = ref<PanelMessage[]>([])
const input = ref('')
const running = ref(false)
const drawerOpen = ref(false)
const engineRef = ref<AgentEngine | null>(null)
const copied = ref<Record<string, boolean>>({})
let copyTimer: ReturnType<typeof setTimeout> | undefined

function baseSystemPrompt(): string {
  const skillsContext = buildSkillsContext(listSkills())
  return (
    '你是「AI导演台」的 AI 导演助手，负责帮助用户完成剧本创作、分镜设计、角色设定、' +
    '提示词生成等影视制作任务。需要完成具体任务时使用工具调用标记' +
    '（[[tool:工具名(参数=值)]]），调用完成后用简洁中文总结结果。' +
    (skillsContext ? `\n\n可参考的技能与模板：\n${skillsContext}` : '')
  )
}

function getEngine(): AgentEngine {
  if (!engineRef.value) {
    engineRef.value = createAgent({
      llm: {
        chat: (msg) => {
          const current = llmRef.value
          if (!current) throw new Error('未配置 LLM Provider')
          return current.chat(msg)
        },
      },
      tools: createProjectTools(),
      systemPrompt: baseSystemPrompt(),
    })
  }
  return engineRef.value
}

function onSkillsChanged(): void {
  // 技能抽屉中的启停/安装会改变技能上下文，刷新系统提示词
  engineRef.value?.setSystemPrompt(baseSystemPrompt())
}

async function send(): Promise<void> {
  const text = input.value.trim()
  if (!text || running.value) return
  input.value = ''
  messages.value.push({ role: 'user', text })
  messages.value.push({ role: 'assistant', text: '正在思考…' })
  running.value = true
  try {
    const turn = await getEngine().run(text)
    const toolSummary = turn.toolResults.map((r) =>
      r.ok ? `🔧 ${r.name}：${r.summary}` : `⚠️ ${r.name}：${r.summary}`,
    )
    const applyTargets = turn.toolResults
      .filter((r): r is typeof r & { applyTarget: AgentApplyTarget } => Boolean(r.applyTarget))
      .map((r) => r.applyTarget)
    messages.value[messages.value.length - 1] = {
      role: 'assistant',
      text: turn.assistantText,
      ...(toolSummary.length > 0 ? { toolSummary } : {}),
      ...(applyTargets.length > 0 ? { applyTargets } : {}),
    }
  } catch (err) {
    messages.value[messages.value.length - 1] = {
      role: 'assistant',
      text: `出错了：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    running.value = false
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

async function copyPrompt(target: AgentApplyTarget, key: string): Promise<void> {
  const text = target.text ?? ''
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      fallbackCopy(text)
    }
  } catch {
    fallbackCopy(text)
  }
  copied.value = { ...copied.value, [key]: true }
  if (copyTimer !== undefined) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = { ...copied.value, [key]: false }
  }, 2000)
}

onBeforeUnmount(() => {
  if (copyTimer !== undefined) clearTimeout(copyTimer)
})

const APPLY_LABELS: Record<AgentApplyTargetKind, string> = {
  script: '剧本',
  prompt: '提示词',
  portrait: '角色',
  shot: '镜头',
  workflow: '工作流',
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4" data-test="agent-panel">
    <div
      v-if="!llmProvider"
      class="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-edge bg-zinc-900/40 p-8 text-center"
      data-test="agent-empty"
    >
      <p class="text-sm text-ink">尚未配置大语言模型（LLM）Provider</p>
      <p class="max-w-md text-xs leading-relaxed text-ink-muted">
        AI 助手需要大语言模型来完成对话与工具调用，请前往「设置」模块配置并启用 LLM
        Provider。
      </p>
    </div>

    <div v-else class="flex h-full min-h-0 flex-col gap-3">
      <header
        class="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-edge bg-zinc-900/40 px-4 py-3"
      >
        <div>
          <h2 class="text-sm font-semibold text-ink">AI 助手</h2>
          <p class="text-xs text-ink-muted">当前 LLM：{{ llmProvider.name }}</p>
        </div>
        <Button size="sm" variant="ghost" data-test="agent-drawer-toggle" @click="drawerOpen = true">
          📦 技能
        </Button>
      </header>

      <div
        class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-edge bg-zinc-900/40 p-4"
      >
        <div
          v-for="(msg, mi) in messages"
          :key="mi"
          data-test="agent-message"
          class="flex"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed"
            :class="msg.role === 'user' ? 'bg-amber-400/90 text-zinc-950' : 'bg-zinc-800 text-ink'"
          >
            <p class="whitespace-pre-wrap">{{ msg.text }}</p>
            <ul
              v-if="msg.toolSummary?.length"
              class="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2 text-xs"
            >
              <li
                v-for="(s, si) in msg.toolSummary"
                :key="si"
                data-test="agent-tool-summary"
                class="text-ink-muted"
              >
                {{ s }}
              </li>
            </ul>
            <div
              v-if="msg.applyTargets?.length"
              class="mt-2 flex flex-col gap-1.5 border-t border-white/10 pt-2 text-xs"
            >
              <div
                v-for="(target, ai) in msg.applyTargets"
                :key="ai"
                class="flex items-center gap-2"
                data-test="agent-apply"
              >
                <template v-if="target.kind === 'script'">
                  <Badge variant="success">剧本已导入</Badge>
                </template>
                <template v-else-if="target.kind === 'prompt'">
                  <span class="text-ink-muted">应用：提示词</span>
                  <Button size="sm" data-test="apply-copy" @click="copyPrompt(target, `${mi}:${ai}`)">
                    {{ copied[`${mi}:${ai}`] ? '已复制' : '复制提示词' }}
                  </Button>
                </template>
                <template v-else>
                  <span class="text-ink-muted">
                    应用：{{ APPLY_LABELS[target.kind] }}{{ target.id ? ` ${target.id}` : '' }}
                  </span>
                </template>
              </div>
            </div>
          </div>
        </div>
        <p
          v-if="messages.length === 0"
          class="m-auto max-w-md text-center text-xs leading-relaxed text-ink-muted"
        >
          与 AI 导演助手对话：可要求生成剧本、切分镜头、创建立绘、扩写提示词等。
        </p>
      </div>

      <div class="flex shrink-0 items-end gap-2">
        <Textarea
          v-model="input"
          :rows="2"
          placeholder="输入指令，Enter 发送（Shift+Enter 换行）"
          class="flex-1"
          data-test="agent-input"
          @keydown="onKeydown"
        />
        <Button variant="primary" :disabled="running" data-test="agent-send" @click="send">
          {{ running ? '思考中…' : '发送' }}
        </Button>
      </div>
    </div>

    <SkillDrawer :open="drawerOpen" @close="drawerOpen = false" @changed="onSkillsChanged" />
  </div>
</template>
