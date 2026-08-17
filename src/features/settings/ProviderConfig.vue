<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Badge, Input, Switch } from '../../components/ui'
import { usePluginStore } from '../../stores/pluginStore'
import type { ProviderConfigField, ProviderPlugin } from '../../core/plugin/types'
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

let saveTimer: ReturnType<typeof setTimeout> | undefined

watch(
  config,
  () => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveProviderConfig(props.provider.id, { ...config })
      emit('changed')
    }, 300)
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

const FIELD_META: Record<
  ProviderConfigField,
  { label: string; placeholder: string; type?: 'text' | 'password' }
> = {
  baseUrl: { label: '地址 Base URL', placeholder: 'http://localhost:8000' },
  apiKey: { label: 'Token / 密钥', placeholder: 'sk-...', type: 'password' },
  model: { label: '模型名', placeholder: 'model-name' },
}

const fields = computed<ProviderConfigField[]>(() => props.provider.configFields ?? [])

function fieldTestKey(field: ProviderConfigField): string {
  return `config-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}
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

    <div v-if="fields.length > 0" class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <label v-for="field in fields" :key="field" class="block">
        <span class="mb-1 block text-xs text-ink-muted">{{ FIELD_META[field].label }}</span>
        <Input
          :model-value="String(config[field] ?? '')"
          :type="FIELD_META[field].type ?? 'text'"
          :placeholder="FIELD_META[field].placeholder"
          :data-test="fieldTestKey(field)"
          @update:model-value="config[field] = $event"
        />
      </label>
    </div>
    <p v-else class="mt-3 text-xs text-ink-muted" data-test="no-config-fields">
      该插件无需额外配置。
    </p>
  </div>
</template>
