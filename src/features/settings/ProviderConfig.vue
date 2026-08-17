<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Badge, Button, Input, Select, Switch, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import { usePluginStore } from '../../stores/pluginStore'
import type { ProviderConfigField, ProviderPlugin } from '../../core/plugin/types'
import { loadProviderConfig, saveProviderConfig } from './httpBackendConfig'
import type { ProviderConfig } from './httpBackendConfig'
import { listWorkflowTemplates } from '../comfyui/workflowStore'
import { MEDIA_COMFYUI_ID } from '../../plugins/providers/media-comfyui'
import WorkflowTemplateManager from './WorkflowTemplateManager.vue'

const props = defineProps<{
  provider: ProviderPlugin
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const store = usePluginStore()

const expanded = ref(false)

const isComfyUi = computed(() => props.provider.id === MEDIA_COMFYUI_ID)

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
  {
    label: string
    placeholder: string
    type?: 'text' | 'password'
    multiline?: boolean
    templateSelect?: boolean
  }
> = {
  baseUrl: { label: '地址 Base URL', placeholder: 'http://127.0.0.1:8188' },
  apiKey: { label: 'Token / 密钥', placeholder: 'sk-...', type: 'password' },
  model: { label: '模型名', placeholder: 'model-name' },
  workflow: {
    label: '工作流模板（API 格式 JSON）',
    placeholder: '包含 {prompt} / {negative_prompt} / {seed} 占位符的工作流 JSON',
    multiline: true,
  },
  workflowTemplateId: {
    label: '文生图工作流模板',
    placeholder: '选择已保存的文生图工作流模板',
    templateSelect: true,
  },
  videoWorkflowTemplateId: {
    label: '视频工作流模板',
    placeholder: '选择用于文生视频/图生视频的 ComfyUI 工作流模板',
    templateSelect: true,
  },
  img2imgWorkflowTemplateId: {
    label: '图生图工作流模板',
    placeholder: '选择用于参考生图（图生图）的 ComfyUI 工作流模板',
    templateSelect: true,
  },
  continuationVideoWorkflowTemplateId: {
    label: '视频续写工作流模板',
    placeholder: '选择用于参照上一段视频结尾继续生成（如 MiniMax H3 Motion Context）的模板',
    templateSelect: true,
  },
}

const fields = computed<ProviderConfigField[]>(() => props.provider.configFields ?? [])

const templateOptions = computed<SelectOption[]>(() => [
  { value: '', label: '默认内置模板' },
  ...listWorkflowTemplates().map((t) => ({ value: t.id, label: t.name })),
])

function fieldTestKey(field: ProviderConfigField): string {
  return `config-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

// 与 pluginStore.resolveInstance 的回退逻辑一致：
// 显式选择 > 同类型第一个启用插件
const isActive = computed<boolean>(() => {
  if (!store.isEnabled(props.provider.id)) return false
  const selected = store.activeProviders[props.provider.providerType]
  if (selected) return selected === props.provider.id
  return store.enabledProviders(props.provider.providerType)[0]?.id === props.provider.id
})

function setActive(): void {
  store.setActiveProvider(props.provider.providerType, props.provider.id)
}
</script>

<template>
  <div class="rounded-lg border border-edge bg-zinc-900/40" data-test="provider-config">
    <div
      class="flex cursor-pointer items-center justify-between gap-3 p-4"
      data-test="provider-header"
      @click="expanded = !expanded"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-xs text-ink-muted transition-transform" :class="expanded ? 'rotate-90' : ''">▸</span>
          <h3 class="truncate text-sm font-medium text-ink">{{ provider.name }}</h3>
          <Badge :variant="typeVariant" data-test="provider-type">{{ provider.providerType }}</Badge>
        </div>
        <p v-if="provider.description" class="mt-0.5 pl-4 text-xs text-ink-muted">
          {{ provider.description }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2" @click.stop>
        <Badge v-if="isActive" variant="success" data-test="provider-active">当前使用</Badge>
        <Button
          v-if="!isActive && store.isEnabled(provider.id)"
          variant="outline"
          size="sm"
          data-test="provider-set-active"
          @click="setActive"
        >
          设为当前使用
        </Button>
        <Switch
          :model-value="store.isEnabled(provider.id)"
          label="启用"
          data-test="provider-toggle"
          @update:model-value="onToggle"
        />
      </div>
    </div>

    <div v-if="expanded" class="flex flex-col gap-4 border-t border-edge p-4">
      <template v-if="fields.length > 0">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label
            v-for="field in fields"
            :key="field"
            class="block"
            :class="FIELD_META[field].multiline ? 'sm:col-span-3' : ''"
          >
            <span class="mb-1 block text-xs text-ink-muted">{{ FIELD_META[field].label }}</span>
            <Select
              v-if="FIELD_META[field].templateSelect"
              :model-value="String(config[field] ?? '')"
              :options="templateOptions"
              :data-test="fieldTestKey(field)"
              @update:model-value="config[field] = $event"
            />
            <Textarea
              v-else-if="FIELD_META[field].multiline"
              :model-value="String(config[field] ?? '')"
              :rows="8"
              :placeholder="FIELD_META[field].placeholder"
              class="font-mono text-xs"
              :data-test="fieldTestKey(field)"
              @update:model-value="config[field] = $event"
            />
            <Input
              v-else
              :model-value="String(config[field] ?? '')"
              :type="FIELD_META[field].type ?? 'text'"
              :placeholder="FIELD_META[field].placeholder"
              :data-test="fieldTestKey(field)"
              @update:model-value="config[field] = $event"
            />
          </label>
        </div>
      </template>
      <p v-else class="text-xs text-ink-muted" data-test="no-config-fields">
        该插件无需额外配置。
      </p>

      <WorkflowTemplateManager v-if="isComfyUi" />
    </div>
  </div>
</template>
