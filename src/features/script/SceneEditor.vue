<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useScriptStore } from '../../stores/scriptStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useAssetUrls } from '../shared/useAssetUrls'
import { useScriptFeatures } from './useScriptFeatures'
import { Button, Input, Select, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import type { Scene } from '../../core/models'
import BeatList from './BeatList.vue'

const props = defineProps<{ sceneId: string }>()

const store = useScriptStore()
const pluginStore = usePluginStore()
const features = useScriptFeatures()
const { resolveAsset, urlOf } = useAssetUrls()

const scene = computed(() => store.scenes.find((s) => s.id === props.sceneId))

function setField(patch: Partial<Omit<Scene, 'id'>>): void {
  if (!scene.value) return
  store.updateScene(scene.value.id, patch)
}

const busy = ref(false)
const message = ref('')
const uploadMessage = ref('')

const artModeOptions: SelectOption[] = [
  { value: 'auto', label: '自动' },
  { value: 'text2image', label: '文生图' },
  { value: 'img2img', label: '图生图' },
]

function setArtMode(value: string): void {
  if (!scene.value) return
  const mode = value === 'text2image' || value === 'img2img' ? value : undefined
  store.updateScene(scene.value.id, { artMode: mode })
}

watch(
  () => [scene.value?.sceneImage, ...(scene.value?.referenceImages ?? [])],
  (ids) => {
    for (const id of ids) if (id) void resolveAsset(id)
  },
  { immediate: true },
)

async function onUploadReference(e: Event): Promise<void> {
  uploadMessage.value = ''
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0 || !scene.value) return
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
    store.updateScene(scene.value.id, {
      referenceImages: [...scene.value.referenceImages, ...ids],
    })
    uploadMessage.value = `已上传 ${ids.length} 张参考图。`
  } catch (err) {
    uploadMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

function removeReference(id: string): void {
  if (!scene.value) return
  store.updateScene(scene.value.id, {
    referenceImages: scene.value.referenceImages.filter((r) => r !== id),
  })
  void pluginStore.storageProvider?.revokeAssetUrl?.(id)
}

function removeSceneImage(): void {
  if (!scene.value) return
  store.updateScene(scene.value.id, { sceneImage: undefined })
}

async function onGenerateSceneImage(): Promise<void> {
  message.value = ''
  if (!scene.value) return
  busy.value = true
  try {
    const job = await features.generateSceneImage(scene.value.id)
    message.value = job
      ? `场景图生成任务已创建（${job.id}），完成后将显示在场景图区域。`
      : '未配置媒体 Provider，无法生成场景图。'
  } catch (err) {
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="scene" class="flex flex-col gap-4 p-4">
    <!-- 块 1：标题 -->
    <section class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-3">
      <h3 class="text-sm font-semibold text-ink">标题</h3>
      <label class="block">
        <Input
          :model-value="scene.title ?? ''"
          placeholder="未命名场次"
          data-test="scene-title"
          @update:model-value="setField({ title: $event || undefined })"
        />
      </label>
    </section>

    <!-- 块 2：场景 -->
    <section class="flex flex-col gap-4 rounded-lg border border-edge bg-raised p-3">
      <h3 class="text-sm font-semibold text-ink">场景</h3>

      <div class="flex flex-col gap-2">
        <h4 class="text-xs font-medium text-ink-muted">场景描述</h4>
        <Textarea
          :model-value="scene.description ?? ''"
          :rows="4"
          placeholder="例如：破败的老式天台，晾衣绳随风晃动，傍晚橘色光线，氛围压抑"
          data-test="scene-description"
          @update:model-value="setField({ description: $event || undefined })"
        />
        <p class="text-[10px] text-ink-muted">地点、时间直接写在描述里，例如：屋顶，夜晚，……</p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-medium text-ink-muted">场景图</h4>
          <label class="flex items-center gap-2 text-xs text-ink-muted">
            生成方式
            <Select
              :model-value="scene.artMode ?? 'auto'"
              :options="artModeOptions"
              class="w-28"
              data-test="scene-art-mode"
              @update:model-value="setArtMode"
            />
          </label>
        </div>
        <p class="text-[10px] text-ink-muted">
          场景图由场景描述直接生成；上传参考图可走图生图，未配置模板时自动用内置 MiniMax H3 搭建
        </p>
        <div class="flex flex-wrap gap-2">
          <div v-if="scene.sceneImage" class="group relative" data-test="scene-image-item">
            <img
              v-if="urlOf(scene.sceneImage)"
              :src="urlOf(scene.sceneImage)"
              class="h-24 w-40 rounded-md border border-edge bg-zinc-800 object-cover"
              alt="场景图"
              data-test="scene-image"
            />
            <div
              v-else
              class="flex h-24 w-40 items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
            >
              加载中
            </div>
            <button
              type="button"
              aria-label="删除场景图"
              title="删除场景图"
              data-test="scene-image-remove"
              class="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-edge bg-zinc-950 text-xs leading-none text-ink-muted transition-colors hover:border-red-500/60 hover:text-red-400 group-hover:flex"
              @click="removeSceneImage"
            >
              ×
            </button>
          </div>
          <template v-for="r in scene.referenceImages" :key="r">
            <div class="group relative" data-test="scene-ref-item">
              <img
                v-if="urlOf(r)"
                :src="urlOf(r)"
                class="h-24 w-40 rounded-md border border-edge bg-zinc-800 object-cover"
                alt="参考图"
                data-test="scene-ref-image"
              />
              <div
                v-else
                class="flex h-24 w-40 items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
              >
                加载中
              </div>
              <button
                type="button"
                aria-label="删除参考图"
                title="删除参考图"
                data-test="scene-ref-remove"
                class="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-edge bg-zinc-950 text-xs leading-none text-ink-muted transition-colors hover:border-red-500/60 hover:text-red-400 group-hover:flex"
                @click="removeReference(r)"
              >
                ×
              </button>
            </div>
          </template>
          <label
            class="flex h-24 w-40 cursor-pointer select-none flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-zinc-600 bg-zinc-900/40 text-zinc-500 transition-colors hover:border-amber-400/60 hover:text-amber-300"
            :class="{ 'pointer-events-none opacity-40': busy }"
            data-test="scene-ref-upload"
            title="上传参考图"
          >
            <span class="text-base leading-none">+</span>
            <span class="text-[10px]">上传参考图</span>
            <input
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              data-test="scene-ref-upload-input"
              @change="onUploadReference"
            />
          </label>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            :disabled="busy"
            data-test="gen-scene-image"
            @click="onGenerateSceneImage"
          >
            生成场景图
          </Button>
          <p v-if="message" class="text-xs text-amber-300" data-test="scene-message">
            {{ message }}
          </p>
        </div>
        <p v-if="uploadMessage" class="text-xs text-amber-300" data-test="scene-upload-message">
          {{ uploadMessage }}
        </p>
      </div>
    </section>

    <!-- 块 3：叙事 -->
    <section class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-3">
      <h3 class="text-sm font-semibold text-ink">叙事节拍</h3>
      <BeatList :scene-id="scene.id" />
    </section>
  </div>
</template>
