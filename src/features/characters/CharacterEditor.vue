<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useCharacterFeatures } from './useCharacterFeatures'
import { useAssetUrls } from '../shared/useAssetUrls'
import { useAssetPreview } from '../shared/assetPreview'
import { Button, Input, Textarea } from '../../components/ui'
import type { Character } from '../../core/models'

const props = defineProps<{ characterId: string }>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useCharacterStore()
const pluginStore = usePluginStore()
const features = useCharacterFeatures()
const { resolveAsset, urlOf } = useAssetUrls()
const { openPreview } = useAssetPreview()

const character = computed(() => store.getCharacter(props.characterId))

const aiInputOpen = ref(false)
const seedIdea = ref('')
const aiMessage = ref('')
const message = ref('')
const uploadMessage = ref('')
const busy = ref(false)

watch(
  () => character.value?.referenceImages,
  (ids) => {
    for (const id of ids ?? []) void resolveAsset(id)
  },
  { immediate: true, deep: true },
)

const tagsText = computed({
  get: () => character.value?.tags.join(', ') ?? '',
  set: (value: string) => {
    if (!character.value) return
    const tags = value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    store.updateCharacter(character.value.id, { tags })
  },
})

function setField(patch: Partial<Omit<Character, 'id'>>): void {
  if (!character.value) return
  store.updateCharacter(character.value.id, patch)
}

function setLoraName(value: string): void {
  if (!character.value) return
  store.updateCharacter(character.value.id, {
    loraConfig: { ...(character.value.loraConfig ?? {}), name: value },
  })
}

function setLoraWeight(value: string): void {
  if (!character.value) return
  const weight = Number(value)
  store.updateCharacter(character.value.id, {
    loraConfig: { ...(character.value.loraConfig ?? {}), weight: Number.isFinite(weight) ? weight : 0 },
  })
}

function removeReferenceImage(id: string): void {
  if (!character.value) return
  setField({
    referenceImages: character.value.referenceImages.filter((r) => r !== id),
  })
  uploadMessage.value = '已删除参考图。'
  void pluginStore.storageProvider?.revokeAssetUrl?.(id)
}

function onDeleteCharacter(): void {
  const c = character.value
  if (!c) return
  for (const id of c.referenceImages) {
    void pluginStore.storageProvider?.revokeAssetUrl?.(id)
  }
  store.removeCharacter(c.id)
  emit('close')
}

async function onUploadFiles(e: Event): Promise<void> {
  uploadMessage.value = ''
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  if (!character.value) return
  const storage = pluginStore.storageProvider
  if (!storage) {
    uploadMessage.value = '未配置存储 Provider，无法上传参考图。'
    return
  }
  busy.value = true
  try {
    const ids: string[] = []
    for (const file of files) {
      const asset = await storage.saveAsset(file, { kind: 'image', source: 'upload' })
      ids.push(asset.id)
    }
    setField({ referenceImages: [...character.value.referenceImages, ...ids] })
    uploadMessage.value = `已上传 ${ids.length} 张参考图。`
  } catch (err) {
    uploadMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function onGenerateDescription(): Promise<void> {
  aiMessage.value = ''
  if (!character.value) return
  const idea = seedIdea.value.trim()
  if (!idea) {
    aiMessage.value = '请先填写角色描述。'
    return
  }
  busy.value = true
  try {
    const res = await features.generateCharacterDescription(idea)
    if (res.ok && res.data) {
      const d = res.data
      setField({
        ...(d.name !== undefined && d.name.trim().length > 0 ? { name: d.name.trim() } : {}),
        ...(d.bio !== undefined ? { bio: d.bio } : {}),
        ...(d.appearance !== undefined ? { appearance: d.appearance } : {}),
        ...(d.tags !== undefined ? { tags: d.tags } : {}),
        ...(d.voice !== undefined ? { voice: d.voice } : {}),
      })
      aiMessage.value = '已生成角色设定（名称 / 简介 / 标签 / 音色 / 详细描述）。'
    } else {
      aiMessage.value = res.error ?? '角色设定生成失败。'
    }
  } finally {
    busy.value = false
  }
}

async function onGeneratePortrait(): Promise<void> {
  message.value = ''
  const c = character.value
  if (!c) return
  busy.value = true
  try {
    const job = await features.generatePortrait(c.id)
    message.value = job ? `立绘生成任务已创建（${job.id}），完成后将出现在参考图中。` : '未配置媒体 Provider，无法生成立绘。'
  } catch (err) {
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <aside
    v-if="character"
    class="flex w-[28rem] shrink-0 flex-col overflow-y-auto border-l border-edge bg-panel"
  >
    <header class="relative flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
      <h2 class="text-sm font-semibold text-ink">角色详情</h2>
      <div class="flex items-center gap-1">
        <button
          type="button"
          aria-label="AI 辅助"
          title="AI 辅助"
          data-test="editor-ai-btn"
          class="rounded-md px-1.5 py-1 text-sm text-amber-300/90 transition-colors hover:bg-zinc-800 hover:text-amber-300"
          @click="aiInputOpen = !aiInputOpen"
        >
          ✨
        </button>
        <button
          type="button"
          aria-label="关闭"
          data-test="editor-close"
          class="rounded-md p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
    </header>

    <div
      v-if="aiInputOpen"
      class="absolute right-3 top-12 z-20 flex items-center gap-1.5 rounded-lg border border-edge bg-panel p-1.5 shadow-2xl"
      data-test="ai-input-panel"
    >
      <Input
        v-model="seedIdea"
        class="!h-7 w-44 !text-xs"
        placeholder="描述角色"
        data-test="seed-idea"
        @keyup.enter="onGenerateDescription"
      />
      <Button
        variant="primary"
        size="sm"
        class="shrink-0 !h-7"
        data-test="ai-describe"
        :disabled="busy"
        @click="onGenerateDescription"
      >
        生成
      </Button>
      <p v-if="aiMessage" class="text-[10px] text-amber-300" data-test="ai-message">
        {{ aiMessage }}
      </p>
    </div>

    <div class="flex flex-col gap-4 p-4">
      <label class="block text-xs font-medium text-ink-muted">
        角色名
        <Input
          class="mt-1"
          :model-value="character.name"
          data-test="name"
          @update:model-value="setField({ name: $event })"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        标签（逗号分隔）
        <Input
          class="mt-1"
          v-model="tagsText"
          placeholder="主角, 少年"
          data-test="tags"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        简介
        <Textarea
          class="mt-1"
          :model-value="character.bio ?? ''"
          :rows="2"
          placeholder="一句话介绍角色，例如：不服输的都市少年"
          data-test="bio"
          @update:model-value="setField({ bio: $event })"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        详细描述
        <Textarea
          class="mt-1"
          :model-value="character.appearance ?? ''"
          :rows="8"
          placeholder="身高体型、脸型五官、发色发型、瞳色、肤色、服装穿搭、配饰、气质神态、标志性特征等，越详细越有助于生成立绘"
          data-test="appearance"
          @update:model-value="setField({ appearance: $event })"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        音色
        <Input
          class="mt-1"
          :model-value="character.voice ?? ''"
          placeholder="例如 zh-female"
          data-test="voice"
          @update:model-value="setField({ voice: $event || undefined })"
        />
      </label>

      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-ink-muted">LoRA</span>
        <div class="grid grid-cols-2 gap-2">
          <Input
            :model-value="String(character.loraConfig?.name ?? '')"
            placeholder="LoRA 名称"
            data-test="lora-name"
            @update:model-value="setLoraName"
          />
          <Input
            :model-value="String(character.loraConfig?.weight ?? 0)"
            placeholder="权重"
            data-test="lora-weight"
            @update:model-value="setLoraWeight"
          />
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-ink-muted">参考图</span>
          <button
            type="button"
            aria-label="AI 生成立绘"
            title="用角色详情生成立绘"
            data-test="ref-gen-btn"
            class="rounded-md px-1.5 py-0.5 text-sm text-amber-300/90 transition-colors hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-40"
            :disabled="busy"
            @click="onGeneratePortrait"
          >
            ✨
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <template v-for="r in character.referenceImages" :key="r">
            <div class="group relative" data-test="ref-item">
              <img
                v-if="urlOf(r)"
                :src="urlOf(r)"
                class="h-20 w-20 cursor-zoom-in rounded-md border border-edge bg-zinc-800 object-cover"
                alt="参考图"
                data-test="ref-image"
                @click="openPreview(urlOf(r)!, 'image', character.name)"
              />
              <div
                v-else
                class="flex h-20 w-20 items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
              >
                加载中
              </div>
              <button
                type="button"
                aria-label="删除参考图"
                title="删除参考图"
                data-test="ref-remove"
                class="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-edge bg-zinc-950 text-xs leading-none text-ink-muted transition-colors hover:border-red-500/60 hover:text-red-400 group-hover:flex"
                @click="removeReferenceImage(r)"
              >
                ✕
              </button>
            </div>
          </template>
          <label
            class="flex h-20 w-20 cursor-pointer select-none flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-zinc-600 bg-zinc-900/40 text-zinc-500 transition-colors hover:border-amber-400/60 hover:text-amber-300"
            :class="{ 'pointer-events-none opacity-40': busy }"
            data-test="ref-upload-btn"
            title="上传本地图片"
          >
            <span class="text-base leading-none">+</span>
            <span class="text-[10px]">上传</span>
            <input
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              data-test="ref-upload-input"
              @change="onUploadFiles"
            />
          </label>
        </div>
        <p v-if="uploadMessage" class="text-xs text-amber-300" data-test="upload-message">
          {{ uploadMessage }}
        </p>
        <p v-if="message" class="text-xs text-amber-300" data-test="message">{{ message }}</p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        class="text-red-300"
        data-test="delete-character"
        @click="onDeleteCharacter"
      >
        删除角色
      </Button>
    </div>

  </aside>
</template>
