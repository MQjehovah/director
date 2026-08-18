<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Badge, Button, Input, Select, Switch, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import { usePluginStore } from '../../stores/pluginStore'
import {
  MEDIA_CAPABILITY_LABELS,
  type MediaCapability,
  type ProviderConfigField,
  type ProviderPlugin,
} from '../../core/plugin/types'
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

// 媒体 Provider 的能力由「能力分配」逐项选择，不再使用单一「当前使用」概念
const isMedia = computed(() => props.provider.providerType === 'media')

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
    label: '文生图模板',
    placeholder: '选择已保存的文生图工作流模板',
    templateSelect: true,
  },
  textVideoWorkflowTemplateId: {
    label: '文生视频模板',
    placeholder: '选择用于文生视频（无参考帧）的 ComfyUI 工作流模板',
    templateSelect: true,
  },
  imageVideoWorkflowTemplateId: {
    label: '参考生视频模板',
    placeholder: '选择用于参考生视频（单图/首帧）的 ComfyUI 工作流模板',
    templateSelect: true,
  },
  firstLastFrameWorkflowTemplateId: {
    label: '首尾帧视频模板',
    placeholder: '选择用于首尾帧文生视频的 ComfyUI 工作流模板',
    templateSelect: true,
  },
  videoWorkflowTemplateId: {
    label: '通用视频模板（兼容）',
    placeholder: '旧配置：未配置专用模板时回退使用',
    templateSelect: true,
  },
  img2imgWorkflowTemplateId: {
    label: '参考生图模板',
    placeholder: '选择用于参考生图（图生图）的 ComfyUI 工作流模板',
    templateSelect: true,
  },
}

const fields = computed<ProviderConfigField[]>(() => props.provider.configFields ?? [])

const templateOptions = computed<SelectOption[]>(() => [
  { value: '', label: '默认内置模板' },
  ...listWorkflowTemplates().map((t) => ({ value: t.id, label: t.name })),
])

const capabilityChips = computed<MediaCapability[]>(() =>
  (props.provider.capabilities ?? []).filter(
    (cap): cap is MediaCapability => cap in MEDIA_CAPABILITY_LABELS,
  ),
)

/** 该能力当前是否由本 Provider 提供（即能力匹配解析到本 Provider） */
function providesCapability(cap: MediaCapability): boolean {
  return store.resolveProviderCapability('media', cap)?.id === props.provider.id
}

/** 提供该能力的所有已启用 Provider（含「自动匹配」） */
function providersForCapability(cap: MediaCapability): SelectOption[] {
  return [
    { value: '', label: '自动匹配' },
    ...store
      .enabledProviders('media')
      .filter((p) => p.capabilities === undefined || p.capabilities.includes(cap))
      .map((p) => ({ value: p.id, label: p.name })),
  ]
}

function assignedProviderId(cap: MediaCapability): string {
  return store.capabilityProviderFor(cap) ?? ''
}

function onAssignCapability(cap: MediaCapability, value: string): void {
  store.setCapabilityProvider(cap, value || undefined)
}

function fieldTestKey(field: ProviderConfigField): string {
  return `config-${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

// 与 pluginStore.resolveInstance 的回退逻辑一致：
// 显式选择 > 同类型第一个启用插件（仅非媒体 Provider 使用）
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
        <Button
          v-if="!isMedia && !isActive && store.isEnabled(provider.id)"
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
      <div
        v-if="capabilityChips.length > 0"
        class="flex flex-col gap-2 rounded-md border border-edge bg-zinc-900/60 p-3"
        data-test="capability-assignment"
      >
        <span class="text-xs font-medium text-ink-muted">
          能力分配（每个能力选择由哪个 Provider 提供）
        </span>
        <div
          v-for="cap in capabilityChips"
          :key="cap"
          class="flex items-center justify-between gap-3"
          data-test="cap-assign-row"
        >
          <span class="flex min-w-0 items-center gap-2 text-sm text-ink">
            <span class="truncate">
              {{ MEDIA_CAPABILITY_LABELS[cap as keyof typeof MEDIA_CAPABILITY_LABELS] }}
            </span>
            <span
              v-if="providesCapability(cap)"
              class="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
              data-test="cap-providing"
            >
              当前提供
            </span>
          </span>
          <Select
            :model-value="assignedProviderId(cap)"
            :options="providersForCapability(cap)"
            class="w-44 shrink-0"
            :data-test="`cap-assign-${cap}`"
            @update:model-value="onAssignCapability(cap, $event)"
          />
        </div>
      </div>

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
