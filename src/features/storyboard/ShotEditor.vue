<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useCharacterStore } from '../../stores/characterStore'
import { useShotActions } from './useShotActions'
import { useAssetUrls } from '../shared/useAssetUrls'
import { useAssetPreview } from '../shared/assetPreview'
import { getWorkflowTemplate } from '../comfyui/workflowStore'
import type { WorkflowParameter } from '../comfyui/workflowStore'
import { loadProviderConfig } from '../settings/httpBackendConfig'
import { MEDIA_COMFYUI_ID } from '../../plugins/providers/media-comfyui'
import { Badge, Button, Input, Progress, Select, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import { DEFAULT_SHOT_DURATION, MAX_SHOT_DURATION } from '../../core/models'
import type { Shot } from '../../core/models'

type CameraShape = NonNullable<Shot['camera']>

const DEFAULT_CAMERA: CameraShape = {
  shotSize: 'medium',
  angle: 'eye-level',
  move: 'static',
  duration: DEFAULT_SHOT_DURATION,
}

const props = defineProps<{ shotId: string }>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'remove', id: string): void
}>()

const store = useStoryboardStore()
const pluginStore = usePluginStore()
const scriptStore = useScriptStore()
const characterStore = useCharacterStore()
const actions = useShotActions()
const { resolveAsset, urlOf } = useAssetUrls()
const { openPreview } = useAssetPreview()

const shot = computed(() => store.shotById(props.shotId))
const busy = ref(false)
const message = ref('')
const frameMessage = ref('')

watch(
  () => [
    shot.value?.metadata?.firstFrameAssetId,
    shot.value?.metadata?.lastFrameAssetId,
    shot.value?.metadata?.referenceImageAssetId,
  ],
  (ids) => {
    for (const id of ids) {
      if (typeof id === 'string') void resolveAsset(id)
    }
  },
  { immediate: true },
)

const shotTypeOptions: SelectOption[] = [
  { value: 'image', label: '静态图' },
  { value: 'video', label: '视频' },
]

const shotSizeOptions: SelectOption[] = [
  { value: 'close-up', label: '特写' },
  { value: 'medium', label: '中景' },
  { value: 'wide', label: '全景' },
]

const angleOptions: SelectOption[] = [
  { value: 'eye-level', label: '平视' },
  { value: 'high', label: '俯视' },
  { value: 'low', label: '仰视' },
  { value: 'dutch', label: '倾斜' },
]

const moveOptions: SelectOption[] = [
  { value: 'static', label: '固定' },
  { value: 'pan', label: '横摇' },
  { value: 'tilt', label: '俯仰' },
  { value: 'zoom-in', label: '推近' },
  { value: 'zoom-out', label: '拉远' },
  { value: 'tracking', label: '跟拍' },
]

const videoModeOptions: SelectOption[] = [
  { value: 'auto', label: '自动（按参考图推断）' },
  { value: 'text2video', label: '文生视频' },
  { value: 'image2video', label: '参考生视频' },
  { value: 'firstLastFrameVideo', label: '首尾帧生视频' },
]

const currentJob = computed(() => actions.jobForShot(props.shotId))
const isGenerating = computed(
  () => !!currentJob.value && (currentJob.value.status === 'queued' || currentJob.value.status === 'running'),
)

function setField(patch: Partial<Omit<Shot, 'id'>>): void {
  if (shot.value) store.updateShot(shot.value.id, patch)
}

function setCameraField<K extends keyof CameraShape>(field: K, value: CameraShape[K]): void {
  if (!shot.value) return
  store.updateShot(shot.value.id, {
    camera: { ...(shot.value.camera ?? DEFAULT_CAMERA), [field]: value },
  })
}

function setShotType(value: string): void {
  setField({ shotType: value === 'video' ? 'video' : 'image' })
}

function setVideoMode(value: string): void {
  if (!shot.value) return
  const mode =
    value === 'text2video' || value === 'image2video' || value === 'firstLastFrameVideo'
      ? value
      : undefined
  setField({ videoMode: mode })
}

/** 渲染区块：模式选择 + 按模板参数绑定素材/标量 */
const renderModeOptions: SelectOption[] = [
  { value: 'auto', label: '自动（按参考图推断）' },
  { value: 'text2video', label: '文生视频' },
  { value: 'ref2v', label: '参考生视频（多参考）' },
]

const renderMode = computed<'auto' | 'text2video' | 'ref2v'>(
  () => shot.value?.render?.mode ?? 'auto',
)

function setRenderMode(value: string): void {
  if (!shot.value) return
  const mode = value === 'text2video' || value === 'ref2v' ? value : undefined
  setField({
    render:
      mode === undefined
        ? undefined
        : { mode, params: { ...(shot.value?.render?.params ?? {}) } },
  })
}

function renderTemplateIdFor(mode: 'text2video' | 'ref2v'): string | undefined {
  const cfg = loadProviderConfig(MEDIA_COMFYUI_ID)
  const key = mode === 'ref2v' ? 'imageVideoWorkflowTemplateId' : 'textVideoWorkflowTemplateId'
  const value = cfg?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const renderTemplateId = computed(() =>
  renderMode.value === 'auto'
    ? undefined
    : renderTemplateIdFor(renderMode.value),
)

const renderTemplate = computed(() =>
  renderTemplateId.value ? getWorkflowTemplate(renderTemplateId.value) : undefined,
)

const renderAssetParams = computed(
  () =>
    renderTemplate.value?.parameters?.filter(
      (p) => p.type === 'image' || p.type === 'video' || p.type === 'audio',
    ) ?? [],
)

const renderScalarParams = computed(
  () =>
    renderTemplate.value?.parameters?.filter(
      (p) =>
        p.type !== 'image' &&
        p.type !== 'video' &&
        p.type !== 'audio' &&
        !/duration|length|时长/i.test(p.label) &&
        p.input !== 'value',
    ) ?? [],
)

const renderImageCandidates = computed<Array<{ id: string; label: string }>>(() => {
  const out: Array<{ id: string; label: string }> = []
  const seen = new Set<string>()
  const push = (id: string | undefined, label: string): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, label })
  }
  const s = shot.value
  const meta = s?.metadata ?? {}
  for (const c of characterStore.characters) {
    for (const r of c.referenceImages) push(r, `角色「${c.name}」`)
  }
  const scene = scriptStore.scenes.find((x) => x.id === s?.sceneId)
  push(scene?.sceneImage, '场景图')
  for (const r of scene?.referenceImages ?? []) push(r, '场景参考图')
  push(typeof meta.firstFrameAssetId === 'string' ? meta.firstFrameAssetId : undefined, '首帧')
  push(typeof meta.lastFrameAssetId === 'string' ? meta.lastFrameAssetId : undefined, '尾帧')
  push(
    typeof meta.referenceImageAssetId === 'string' ? meta.referenceImageAssetId : undefined,
    '镜头参考图',
  )
  for (const a of s?.mediaAssets ?? []) push(a, '本镜素材')
  return out
})

const renderVideoCandidates = computed<Array<{ id: string; label: string }>>(() => {
  const out: Array<{ id: string; label: string }> = []
  const seen = new Set<string>()
  for (const a of shot.value?.mediaAssets ?? []) {
    if (seen.has(a)) continue
    seen.add(a)
    out.push({ id: a, label: '本镜视频素材' })
  }
  return out
})

function renderParamValue(key: string): unknown {
  return shot.value?.render?.params?.[key]
}

function setRenderParam(key: string, value: string | number | boolean): void {
  if (!shot.value) return
  const current = shot.value.render
  const params = { ...(current?.params ?? {}) }
  if (value === '' || value === undefined || value === null) delete params[key]
  else params[key] = value
  setField({ render: { mode: current?.mode ?? 'ref2v', params } })
}

function renderParamOptions(p: WorkflowParameter): SelectOption[] {
  const candidates =
    p.type === 'video' ? renderVideoCandidates.value : renderImageCandidates.value
  return [
    { value: '', label: '默认 / 自动' },
    ...candidates.map((c) => ({
      value: c.id,
      label: `${c.label}（${c.id.slice(-6)}）`,
    })),
  ]
}

function setPrompt(value: string): void {
  setField({ prompt: value.trim() === '' ? undefined : value })
}

function setDialogue(value: string): void {
  const text = value.trim()
  if (!shot.value) return
  setField({
    metadata: {
      ...(shot.value.metadata ?? {}),
      ...(text ? { dialogue: text } : { dialogue: undefined }),
    },
  })
}

function setNegativePrompt(value: string): void {
  setField({ negativePrompt: value.trim() === '' ? undefined : value })
}

function setSeed(value: string): void {
  const trimmed = value.trim()
  if (trimmed === '') {
    setField({ seed: undefined })
    return
  }
  const seed = Number(trimmed)
  setField({ seed: Number.isFinite(seed) ? seed : undefined })
}

function setDuration(value: string): void {
  const duration = Number(value)
  const clamped =
    Number.isFinite(duration) && duration > 0
      ? Math.min(Math.max(duration, 1), MAX_SHOT_DURATION)
      : DEFAULT_CAMERA.duration
  setCameraField('duration', clamped)
}

function setShotSize(value: string): void {
  setCameraField('shotSize', value as CameraShape['shotSize'])
}

function setAngle(value: string): void {
  setCameraField('angle', value as CameraShape['angle'])
}

function setMove(value: string): void {
  setCameraField('move', value as CameraShape['move'])
}

type FrameKey = 'firstFrameAssetId' | 'lastFrameAssetId'

function frameUrl(key: FrameKey): string | undefined {
  const id = shot.value?.metadata?.[key]
  return typeof id === 'string' ? urlOf(id) : undefined
}

async function onUploadFrame(e: Event, key: FrameKey): Promise<void> {
  frameMessage.value = ''
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !shot.value) return
  const storage = pluginStore.storageProvider
  if (!storage) {
    frameMessage.value = '未配置存储 Provider，无法上传帧图。'
    return
  }
  try {
    const asset = await storage.saveAsset(file, { kind: 'image', source: 'upload' })
    setField({
      metadata: { ...(shot.value.metadata ?? {}), [key]: asset.id },
    })
    void resolveAsset(asset.id)
    frameMessage.value = key === 'firstFrameAssetId' ? '首帧图已上传。' : '尾帧图已上传。'
  } catch (err) {
    frameMessage.value = err instanceof Error ? err.message : String(err)
  }
}

function onRemoveFrame(key: FrameKey): void {
  if (!shot.value) return
  const id = shot.value.metadata?.[key]
  setField({
    metadata: { ...(shot.value.metadata ?? {}), [key]: undefined },
  })
  if (typeof id === 'string') void pluginStore.storageProvider?.revokeAssetUrl?.(id)
}

const scene = computed(() => {
  const sceneId = shot.value?.sceneId
  return sceneId ? scriptStore.scenes.find((s) => s.id === sceneId) : undefined
})

/** 可选的参考图素材：本镜头上传 + 场次参考图 + 场景图 + 角色参考图 */
const referenceCandidates = computed(() => {
  const list: Array<{ id: string; label: string }> = []
  const s = scene.value
  if (s?.sceneImage) list.push({ id: s.sceneImage, label: '场景图' })
  for (const r of s?.referenceImages ?? []) list.push({ id: r, label: '场次参考图' })
  for (const c of characterStore.characters) {
    for (const r of c.referenceImages) list.push({ id: r, label: `角色「${c.name}」` })
  }
  return list.filter((item, i, arr) => arr.findIndex((x) => x.id === item.id) === i)
})

const referenceAssetId = computed(() => {
  const value = shot.value?.metadata?.referenceImageAssetId
  return typeof value === 'string' && value.length > 0 ? value : undefined
})

function referenceUrl(): string | undefined {
  return referenceAssetId.value ? urlOf(referenceAssetId.value) : undefined
}

function setReferenceAsset(id: string): void {
  if (!shot.value) return
  setField({
    metadata: { ...(shot.value.metadata ?? {}), referenceImageAssetId: id },
  })
  void resolveAsset(id)
}

function onRemoveReference(): void {
  if (!shot.value) return
  const id = shot.value.metadata?.referenceImageAssetId
  setField({
    metadata: { ...(shot.value.metadata ?? {}), referenceImageAssetId: undefined },
  })
  if (typeof id === 'string') void pluginStore.storageProvider?.revokeAssetUrl?.(id)
}

async function onUploadReference(e: Event): Promise<void> {
  frameMessage.value = ''
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !shot.value) return
  const storage = pluginStore.storageProvider
  if (!storage) {
    frameMessage.value = '未配置存储 Provider，无法上传参考图。'
    return
  }
  try {
    const asset = await storage.saveAsset(file, { kind: 'image', source: 'upload' })
    setReferenceAsset(asset.id)
    frameMessage.value = '参考图已上传。'
  } catch (err) {
    frameMessage.value = err instanceof Error ? err.message : String(err)
  }
}

async function onGenerate(): Promise<void> {
  message.value = ''
  busy.value = true
  try {
    const job = await actions.generateMedia(props.shotId)
    message.value = job ? `生成任务已创建（${job.id}）。` : '未配置媒体 Provider，无法生成媒体。'
  } catch (err) {
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function onCancel(): Promise<void> {
  message.value = ''
  await actions.cancelGeneration(props.shotId)
  message.value = '已取消生成任务。'
}

async function onRegenerate(): Promise<void> {
  message.value = ''
  busy.value = true
  try {
    const job = await actions.regenerate(props.shotId)
    message.value = job ? `已重新生成（${job.id}）。` : '未配置媒体 Provider，无法生成媒体。'
  } catch (err) {
    message.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function onRemove(): Promise<void> {
  if (!shot.value) return
  await actions.cancelGeneration(props.shotId)
  store.removeShot(props.shotId)
  emit('remove', props.shotId)
  emit('close')
}
</script>

<template>
  <aside
    v-if="shot"
    class="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-edge bg-panel"
  >
    <header class="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
      <h2 class="text-sm font-semibold text-ink">镜头编辑</h2>
      <button
        type="button"
        aria-label="关闭"
        data-test="editor-close"
        class="rounded-md p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <div class="flex flex-col gap-4 p-4">
      <div
        v-if="isGenerating || currentJob"
        class="flex flex-col gap-1 rounded-md border border-edge bg-raised p-3"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-ink">生成任务</span>
          <Badge
            :variant="currentJob?.status === 'done' ? 'success' : currentJob?.status === 'failed' ? 'danger' : 'warning'"
          >
            {{ currentJob?.status }}
          </Badge>
        </div>
        <Progress v-if="isGenerating" :value="currentJob?.progress ?? 0" data-test="editor-progress" />
      </div>

      <label class="block text-xs font-medium text-ink-muted">
        镜头类型
        <Select
          class="mt-1"
          :model-value="shot.shotType"
          :options="shotTypeOptions"
          data-test="shot-type"
          @update:model-value="setShotType"
        />
      </label>

      <div v-if="shot.shotType === 'video'" class="flex flex-col gap-2">
        <label class="block text-xs font-medium text-ink-muted">
          生成方式
          <Select
            class="mt-1"
            :model-value="shot.videoMode ?? 'auto'"
            :options="videoModeOptions"
            data-test="video-mode"
            @update:model-value="setVideoMode"
          />
        </label>

        <div
          class="flex flex-col gap-2 rounded-md border border-edge bg-zinc-900/40 p-2"
          data-test="render-section"
        >
          <label class="block text-xs font-medium text-ink-muted">
            渲染
            <Select
              class="mt-1"
              :model-value="renderMode"
              :options="renderModeOptions"
              data-test="render-mode"
              @update:model-value="setRenderMode"
            />
          </label>
          <p
            v-if="renderMode === 'ref2v' && !renderTemplateId"
            class="text-[10px] leading-relaxed text-amber-300/80"
            data-test="render-no-template"
          >
            未配置参考生视频模板，请在「设置 → ComfyUI 媒体」中为"参考生视频模板"选择已保存的模板。
          </p>
          <div
            v-if="renderMode === 'ref2v' && renderAssetParams.length > 0"
            class="flex flex-col gap-2"
            data-test="render-ref2v-fields"
          >
            <template v-for="p in renderAssetParams" :key="p.nodeId + ':' + p.input">
              <label class="block text-[11px] text-ink-muted">
                {{ p.label }}
                <Select
                  class="mt-0.5"
                  :model-value="String(renderParamValue(p.nodeId + ':' + p.input) ?? '')"
                  :options="renderParamOptions(p)"
                  :data-test="'render-param-' + p.input"
                  @update:model-value="setRenderParam(p.nodeId + ':' + p.input, $event)"
                />
              </label>
            </template>
          </div>
          <div
            v-if="renderMode === 'ref2v' && renderScalarParams.length > 0"
            class="flex flex-col gap-2"
            data-test="render-scalar-fields"
          >
            <template v-for="p in renderScalarParams" :key="p.nodeId + ':' + p.input">
              <label class="block text-[11px] text-ink-muted">
                {{ p.label }}
                <Input
                  v-if="p.type === 'number'"
                  class="mt-0.5"
                  type="number"
                  :model-value="String(renderParamValue(p.nodeId + ':' + p.input) ?? p.value ?? '')"
                  data-test="render-scalar-input"
                  @update:model-value="
                    setRenderParam(p.nodeId + ':' + p.input, Number($event))
                  "
                />
                <Input
                  v-else
                  class="mt-0.5"
                  :model-value="String(renderParamValue(p.nodeId + ':' + p.input) ?? p.value ?? '')"
                  data-test="render-scalar-input"
                  @update:model-value="setRenderParam(p.nodeId + ':' + p.input, $event)"
                />
              </label>
            </template>
          </div>
          <p
            v-if="renderMode === 'text2video'"
            class="text-[10px] leading-relaxed text-ink-muted"
            data-test="render-text2video-hint"
          >
            文生视频直接由提示词生成，无需参考素材。
          </p>
        </div>

        <div
          v-if="shot.videoMode === 'text2video'"
          class="rounded-md bg-zinc-900/60 px-2.5 py-2 text-[10px] leading-relaxed text-ink-muted"
          data-test="text2video-hint"
        >
          文生视频直接由提示词生成，无需参考图。
        </div>

        <div
          v-else-if="shot.videoMode === 'image2video'"
          class="flex flex-col gap-2"
          data-test="reference-section"
        >
          <span class="text-xs font-medium text-ink-muted">参考图（可选角色 / 场景参考图）</span>
          <div class="group relative">
            <img
              v-if="referenceUrl()"
              :src="referenceUrl()"
              class="h-24 w-full cursor-zoom-in rounded-md border border-edge bg-zinc-800 object-cover"
              alt="参考图"
                 data-test="ref-preview"
                @click.stop="openPreview(referenceUrl()!, 'image')"
               />
            <div
              v-else
              class="flex h-24 w-full items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
              data-test="ref-empty"
            >
              未选择
            </div>
            <button
              v-if="referenceAssetId"
              type="button"
              aria-label="删除参考图"
              title="删除参考图"
              data-test="ref-remove"
              class="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-edge bg-zinc-950 text-xs leading-none text-ink-muted transition-colors hover:border-red-500/60 hover:text-red-400 group-hover:flex"
              @click="onRemoveReference"
            >
              ✕
            </button>
          </div>
          <label
            class="flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-zinc-600 bg-zinc-900/40 text-[10px] text-zinc-500 transition-colors hover:border-amber-400/60 hover:text-amber-300"
            :class="{ 'pointer-events-none opacity-40': busy }"
            data-test="ref-upload"
            title="上传参考图"
          >
            <span>+ 上传参考图</span>
            <input
              type="file"
              accept="image/*"
              class="hidden"
              data-test="ref-input"
              @change="onUploadReference"
            />
          </label>
          <div v-if="referenceCandidates.length > 0" class="flex flex-col gap-1">
            <span class="text-[10px] text-ink-muted">从已有素材选择：</span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="c in referenceCandidates"
                :key="c.id"
                type="button"
                class="rounded-md border px-2 py-1 text-[10px] transition-colors"
                :class="
                  c.id === referenceAssetId
                    ? 'border-amber-400/60 text-amber-300'
                    : 'border-edge text-ink-muted hover:border-amber-400/40 hover:text-ink'
                "
                data-test="ref-candidate"
                @click="setReferenceAsset(c.id)"
              >
                {{ c.label }}
              </button>
            </div>
          </div>
        </div>

        <div v-else class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink-muted">首尾帧（首尾帧生视频用）</span>
          <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <div class="group relative">
              <img
                v-if="frameUrl('firstFrameAssetId')"
                :src="frameUrl('firstFrameAssetId')"
                class="h-24 w-full cursor-zoom-in rounded-md border border-edge bg-zinc-800 object-cover"
                alt="首帧"
                 data-test="first-frame-preview"
                @click.stop="openPreview(frameUrl('firstFrameAssetId')!, 'image')"
               />
              <div
                v-else
                class="flex h-24 w-full items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
                data-test="first-frame-empty"
              >
                未设置
              </div>
              <button
                v-if="shot.metadata?.firstFrameAssetId"
                type="button"
                aria-label="删除首帧"
                title="删除首帧"
                data-test="first-frame-remove"
                class="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-edge bg-zinc-950 text-xs leading-none text-ink-muted transition-colors hover:border-red-500/60 hover:text-red-400 group-hover:flex"
                @click="onRemoveFrame('firstFrameAssetId')"
              >
                ✕
              </button>
            </div>
            <label
              class="flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-zinc-600 bg-zinc-900/40 text-[10px] text-zinc-500 transition-colors hover:border-amber-400/60 hover:text-amber-300"
              :class="{ 'pointer-events-none opacity-40': busy }"
              data-test="first-frame-upload"
              title="上传首帧图片"
            >
              <span>+ 首帧</span>
              <input
                type="file"
                accept="image/*"
                class="hidden"
                data-test="first-frame-input"
                @change="onUploadFrame($event, 'firstFrameAssetId')"
              />
            </label>
          </div>
          <div class="flex flex-col gap-1">
            <div class="group relative">
              <img
                v-if="frameUrl('lastFrameAssetId')"
                :src="frameUrl('lastFrameAssetId')"
                class="h-24 w-full cursor-zoom-in rounded-md border border-edge bg-zinc-800 object-cover"
                alt="尾帧"
                 data-test="last-frame-preview"
                @click.stop="openPreview(frameUrl('lastFrameAssetId')!, 'image')"
               />
              <div
                v-else
                class="flex h-24 w-full items-center justify-center rounded-md border border-edge bg-zinc-800 text-[10px] text-ink-muted"
                data-test="last-frame-empty"
              >
                未设置
              </div>
              <button
                v-if="shot.metadata?.lastFrameAssetId"
                type="button"
                aria-label="删除尾帧"
                title="删除尾帧"
                data-test="last-frame-remove"
                class="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-edge bg-zinc-950 text-xs leading-none text-ink-muted transition-colors hover:border-red-500/60 hover:text-red-400 group-hover:flex"
                @click="onRemoveFrame('lastFrameAssetId')"
              >
                ✕
              </button>
            </div>
            <label
              class="flex h-8 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-zinc-600 bg-zinc-900/40 text-[10px] text-zinc-500 transition-colors hover:border-amber-400/60 hover:text-amber-300"
              :class="{ 'pointer-events-none opacity-40': busy }"
              data-test="last-frame-upload"
              title="上传尾帧图片"
            >
              <span>+ 尾帧</span>
              <input
                type="file"
                accept="image/*"
                class="hidden"
                data-test="last-frame-input"
                @change="onUploadFrame($event, 'lastFrameAssetId')"
              />
            </label>
          </div>
          </div>
          <p class="text-[10px] leading-relaxed text-ink-muted">
            上传首尾帧后生成视频时按首尾帧约束起止画面；模板中需配置
            <code class="text-ink">first_frame</code> / <code class="text-ink">last_frame</code>
            或 <code class="text-ink">{last_frame}</code> 占位符。
          </p>
          <p v-if="frameMessage" class="text-xs text-amber-300" data-test="frame-message">
            {{ frameMessage }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <label class="block text-xs font-medium text-ink-muted">
          景别
          <Select
            class="mt-1"
            :model-value="shot.camera?.shotSize ?? DEFAULT_CAMERA.shotSize"
            :options="shotSizeOptions"
            data-test="shot-size"
            @update:model-value="setShotSize"
          />
        </label>
        <label class="block text-xs font-medium text-ink-muted">
          机位
          <Select
            class="mt-1"
            :model-value="shot.camera?.angle ?? DEFAULT_CAMERA.angle"
            :options="angleOptions"
            data-test="angle"
            @update:model-value="setAngle"
          />
        </label>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <label class="block text-xs font-medium text-ink-muted">
          运镜
          <Select
            class="mt-1"
            :model-value="shot.camera?.move ?? DEFAULT_CAMERA.move"
            :options="moveOptions"
            data-test="move"
            @update:model-value="setMove"
          />
        </label>
        <label class="block text-xs font-medium text-ink-muted">
          时长（秒）
          <Input
            class="mt-1"
            type="number"
            :max="String(MAX_SHOT_DURATION)"
            :model-value="String(shot.camera?.duration ?? DEFAULT_CAMERA.duration)"
            data-test="duration"
            @update:model-value="setDuration"
          />
        </label>
      </div>

      <label class="block text-xs font-medium text-ink-muted">
        提示词
        <Textarea
          class="mt-1"
          :model-value="shot.prompt ?? ''"
          :rows="4"
          placeholder="画面描述，例如：夕阳下的少年抬头望向天空"
          data-test="prompt"
          @update:model-value="setPrompt"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        台词（字幕）
        <Textarea
          class="mt-1"
          :model-value="typeof shot.metadata?.dialogue === 'string' ? shot.metadata.dialogue : ''"
          :rows="2"
          placeholder="该镜头内出现的台词，逐行填写，用于成片字幕"
          data-test="dialogue"
          @update:model-value="setDialogue"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        负面提示词
        <Textarea
          class="mt-1"
          :model-value="shot.negativePrompt ?? ''"
          :rows="2"
          placeholder="不希望出现的内容"
          data-test="negative-prompt"
          @update:model-value="setNegativePrompt"
        />
      </label>

      <label class="block text-xs font-medium text-ink-muted">
        随机种子
        <Input
          class="mt-1"
          type="number"
          :model-value="shot.seed === undefined ? '' : String(shot.seed)"
          placeholder="留空使用随机种子"
          data-test="seed"
          @update:model-value="setSeed"
        />
      </label>

      <div class="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          data-test="gen-media"
          :disabled="busy || isGenerating"
          @click="onGenerate"
        >
          生成媒体
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-test="regenerate-media"
          :disabled="busy || isGenerating"
          @click="onRegenerate"
        >
          重新生成
        </Button>
        <Button v-if="isGenerating" variant="ghost" size="sm" data-test="cancel-media" @click="onCancel">
          取消
        </Button>
        <Button variant="ghost" size="sm" class="text-red-300" data-test="remove-shot" @click="onRemove">
          删除镜头
        </Button>
      </div>

      <p v-if="message" class="text-xs text-amber-300" data-test="message">{{ message }}</p>
    </div>
  </aside>
</template>
