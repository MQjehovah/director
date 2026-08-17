<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useCharacterFeatures } from './useCharacterFeatures'
import { useAssetUrls } from '../shared/useAssetUrls'
import { Button, Dialog, Input, Textarea } from '../../components/ui'
import type { Character } from '../../core/models'

const props = defineProps<{ characterId: string }>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useCharacterStore()
const pluginStore = usePluginStore()
const features = useCharacterFeatures()
const { resolveAsset, urlOf } = useAssetUrls()

const character = computed(() => store.getCharacter(props.characterId))

const aiOpen = ref(false)
const seedIdea = ref('')
const imagePrompt = ref((character.value?.metadata.imagePrompt as string | undefined) ?? '')
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

function onImagePromptChange(value: string): void {
  imagePrompt.value = value
  if (!character.value) return
  const prompt = value.trim()
  store.updateCharacter(character.value.id, {
    metadata: {
      ...(character.value.metadata ?? {}),
      ...(prompt ? { imagePrompt: prompt } : { imagePrompt: undefined }),
    },
  })
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
  message.value = ''
  if (!character.value) return
  const idea = seedIdea.value.trim()
  if (!idea) {
    message.value = '请先填写灵感关键词。'
    return
  }
  busy.value = true
  try {
    const res = await features.generateCharacterDescription(idea)
    if (res.ok) {
      setField({ appearance: res.text })
      message.value = '已生成角色设定，可在「外貌描述」中查看与修改。'
    } else {
      message.value = res.error
    }
  } finally {
    busy.value = false
  }
}

async function onExpandPrompt(): Promise<void> {
  message.value = ''
  const c = character.value
  if (!c) return
  const base = c.appearance?.trim()
  if (!base) {
    message.value = '请先填写外貌描述，再扩写参考图提示词。'
    return
  }
  busy.value = true
  try {
    const res = await features.expandReferencePrompt(base)
    if (res.ok) {
      imagePrompt.value = res.text
      setField({ metadata: { ...(c.metadata ?? {}), imagePrompt: res.text } })
    } else {
      message.value = res.error
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
    class="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-edge bg-panel"
  >
    <header class="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
      <h2 class="text-sm font-semibold text-ink">角色详情</h2>
      <div class="flex items-center gap-1">
        <button
          type="button"
          aria-label="AI 辅助"
          title="AI 辅助"
          data-test="editor-ai-btn"
          class="rounded-md px-1.5 py-1 text-sm text-amber-300/90 transition-colors hover:bg-zinc-800 hover:text-amber-300"
          @click="aiOpen = true"
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

    <div class="flex flex-col gap-4 p-4">
      <label class="block text-xs font-medium text-ink-muted">
        姓名
        <Input
          class="mt-1"
          :model-value="character.name"
          data-test="name"
          @update:model-value="setField({ name: $event })"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        外貌描述
        <Textarea
          class="mt-1"
          :model-value="character.appearance ?? ''"
          :rows="5"
          placeholder="角色的外貌、穿着、气质等"
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

      <label class="block text-xs font-medium text-ink-muted">
        标签（逗号分隔）
        <Input
          class="mt-1"
          v-model="tagsText"
          placeholder="主角, 少年"
          data-test="tags"
        />
      </label>

      <div class="flex flex-col gap-2">
        <span class="text-xs font-medium text-ink-muted">参考图</span>
        <div class="flex flex-wrap gap-2">
          <template v-for="r in character.referenceImages" :key="r">
            <img
              v-if="urlOf(r)"
              :src="urlOf(r)"
              class="h-20 w-20 rounded-md border border-edge bg-zinc-800 object-cover"
              alt="参考图"
              data-test="ref-image"
            />
            <div
              v-else
              class="flex h-20 w-20 items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
            >
              加载中
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
      </div>
    </div>

    <Dialog
      :open="aiOpen"
      title="AI 辅助"
      @update:open="aiOpen = $event"
    >
      <div class="flex flex-col gap-5">
        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold text-ink">AI 生成角色信息</h3>
          <div class="flex gap-2">
            <Input v-model="seedIdea" placeholder="灵感关键词，例如：银发剑士" data-test="seed-idea" />
            <Button
              variant="primary"
              size="sm"
              class="shrink-0"
              data-test="ai-describe"
              :disabled="busy"
              @click="onGenerateDescription"
            >
              生成设定
            </Button>
          </div>
          <p class="text-xs text-ink-muted">生成结果会填入「外貌描述」，可随时手动修改。</p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold text-ink">AI 生成角色参考图</h3>
          <Textarea
            :model-value="imagePrompt"
            :rows="4"
            placeholder="参考图提示词（可先 AI 扩写再手动调整）"
            data-test="image-prompt"
            @update:model-value="onImagePromptChange"
          />
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              data-test="ai-expand"
              :disabled="busy"
              @click="onExpandPrompt"
            >
              AI 扩写提示词
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-test="gen-portrait"
              :disabled="busy"
              @click="onGeneratePortrait"
            >
              生成立绘
            </Button>
          </div>
          <p class="text-xs text-ink-muted">生成的立绘完成后会自动加入参考图。</p>
        </section>

        <p v-if="message" class="text-xs text-amber-300" data-test="message">{{ message }}</p>
      </div>
    </Dialog>
  </aside>
</template>
