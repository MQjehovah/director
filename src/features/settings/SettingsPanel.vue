<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '../../components/ui'
import { usePluginStore } from '../../stores/pluginStore'
import type { ProviderPlugin, ProviderType } from '../../core/plugin/types'
import ProviderConfig from './ProviderConfig.vue'
import WorkflowTemplateManager from './WorkflowTemplateManager.vue'

const store = usePluginStore()

const providers = computed<ProviderPlugin[]>(() =>
  store.plugins.filter((p): p is ProviderPlugin => p.kind === 'provider'),
)

const typeLabels: Record<ProviderType, string> = {
  media: '媒体生成',
  llm: '大语言模型',
  tts: '语音合成',
  storage: '存储',
}

const enabledSummary = computed<ProviderType[]>(() => {
  const types: ProviderType[] = ['media', 'llm', 'tts', 'storage']
  return types.filter((t) => store.enabledProviders(t).length > 0)
})
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
    <header>
      <h1 class="text-lg font-semibold text-ink">设置</h1>
      <p class="mt-1 text-xs leading-relaxed text-ink-muted">
        配置各 Provider 的地址、密钥与模型参数，可独立启停能力。未配置真实 Provider 时使用内置 mock。
      </p>
    </header>

    <section data-test="enabled-summary">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">当前启用的能力</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        <Badge v-for="t in enabledSummary" :key="t" variant="success" data-test="enabled-type">
          {{ typeLabels[t] }}
        </Badge>
        <span v-if="enabledSummary.length === 0" class="text-xs text-ink-muted">
          无启用的 Provider，全部使用 mock
        </span>
      </div>
    </section>

    <section>
      <h2 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Provider 列表</h2>
      <div class="mt-2 flex flex-col gap-3">
        <ProviderConfig
          v-for="p in providers"
          :key="p.id"
          :provider="p"
          data-test="provider-row"
        />
        <p v-if="providers.length === 0" data-test="providers-empty" class="text-xs text-ink-muted">
          尚未注册 Provider —— 插件在应用启动时注册（后续任务接入）。
        </p>
      </div>
    </section>

    <WorkflowTemplateManager />
  </div>
</template>
