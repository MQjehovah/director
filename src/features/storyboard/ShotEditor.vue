<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useShotActions } from './useShotActions'
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
const actions = useShotActions()

const shot = computed(() => store.shotById(props.shotId))
const busy = ref(false)
const message = ref('')

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
      <p
        v-if="shot.metadata?.continuationFrom"
        class="text-xs text-amber-300"
        data-test="continuation-hint"
      >
        将延续上一段视频的结尾继续生成
      </p>

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
