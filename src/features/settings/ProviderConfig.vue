<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Badge, Input, Switch } from '../../components/ui'
import { usePluginStore } from '../../stores/pluginStore'
import type { ProviderPlugin } from '../../core/plugin/types'
import { loadProviderConfig, saveProviderConfig } from './httpBackendConfig'
import type { ProviderConfig } from './httpBackendConfig'

const props = defineProps<{
  provider: ProviderPlugin
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const store = usePluginStore()

const config = reactive<ProviderConfig>({
  ...loadProviderConfig(props.provider.id),
})

watch(
  config,
  () => {
    saveProviderConfig(props.provider.id, { ...config })
    emit('changed')
  },
  { deep: true },
)

function onToggle(value: boolean): void {
  store.toggle(props.provider.id, value)
  config.enabled = value
}

const typeVariant = computed<'neutral' | 'success' | 'warning' | 'danger' | 'info'>(() => {
  switch (props.provider.providerType) {
    case 'media':
      return 'info'
    case 'llm':
      return 'success'
    case 'tts':
      return 'warning'
    case 'storage':
      return 'danger'
    default:
      return 'neutral'
  }
})
</script>

<template>
  <div class="rounded-lg border border-edge bg-zinc-900/40 p-4" data-test="provider-config">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="truncate text-sm font-medium text-ink">{{ provider.name }}</h3>
          <Badge :variant="typeVariant" data-test="provider-type">{{ provider.providerType }}</Badge>
        </div>
        <p v-if="provider.description" class="mt-0.5 text-xs text-ink-muted">
          {{ provider.description }}
        </p>
      </div>
      <Switch
        :model-value="store.isEnabled(provider.id)"
        label="启用"
        data-test="provider-toggle"
        @update:model-value="onToggle"
      />
    </div>

    <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label class="block">
        <span class="mb-1 block text-xs text-ink-muted">地址 Base URL</span>
        <Input v-model="config.baseUrl" placeholder="http://localhost:8000" data-test="config-base-url" />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-ink-muted">Token / 密钥</span>
        <Input
          v-model="config.apiKey"
          type="password"
          placeholder="sk-..."
          data-test="config-api-key"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-ink-muted">模型名</span>
        <Input v-model="config.model" placeholder="model-name" data-test="config-model" />
      </label>
    </div>
  </div>
</template>
