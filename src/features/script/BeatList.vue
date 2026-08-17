<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScriptStore } from '../../stores/scriptStore'
import { useScriptFeatures } from './useScriptFeatures'
import { Badge, Button, Input, Select, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import type { Beat } from '../../core/models'

const props = defineProps<{ sceneId: string }>()

const store = useScriptStore()
const features = useScriptFeatures()

const scene = computed(() => store.scenes.find((s) => s.id === props.sceneId))
const beats = computed<Beat[]>(() => scene.value?.beats ?? [])

const beatTypes: SelectOption[] = [
  { value: 'dialogue', label: '对话' },
  { value: 'action', label: '动作' },
  { value: 'sfx', label: '音效' },
]

const newType = ref<Beat['type']>('dialogue')
const rewriteInstruction = ref('')
const busy = ref(false)
const message = ref('')

const typeLabel: Record<Beat['type'], string> = {
  shot: '镜头',
  dialogue: '对话',
  action: '动作',
  sfx: '音效',
}

const typeBadgeVariant: Record<Beat['type'], 'neutral' | 'info' | 'warning' | 'success'> = {
  shot: 'neutral',
  dialogue: 'info',
  action: 'warning',
  sfx: 'success',
}

function addBeat(): void {
  if (newType.value === 'dialogue') {
    store.addBeat(props.sceneId, { type: 'dialogue', dialogue: { speaker: '角色', text: '' } })
  } else {
    store.addBeat(props.sceneId, { type: newType.value, action: '' })
  }
}

function removeBeat(beatId: string): void {
  store.removeBeat(props.sceneId, beatId)
}

function beatById(beatId: string): Beat | undefined {
  return beats.value.find((b) => b.id === beatId)
}

function setDialogueSpeaker(beatId: string, speaker: string): void {
  store.updateBeat(props.sceneId, beatId, {
    type: 'dialogue',
    dialogue: { speaker, text: beatById(beatId)?.dialogue?.text ?? '' },
  })
}

function setDialogueText(beatId: string, text: string): void {
  store.updateBeat(props.sceneId, beatId, {
    type: 'dialogue',
    dialogue: { speaker: beatById(beatId)?.dialogue?.speaker ?? '', text },
  })
}

function setAction(beatId: string, action: string): void {
  store.updateBeat(props.sceneId, beatId, { action })
}

function parseRewritten(text: string): { type: Beat['type']; dialogue?: { speaker: string; text: string }; action?: string } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return null
  const firstLine = lines[0]
  if (firstLine.startsWith('动作') && firstLine.length > 2 && (firstLine[2] === '：' || firstLine[2] === ':')) {
    return { type: 'action', action: lines.map((l) => l.replace(/^动作[：:]\s*/, '')).join('\n') }
  }
  if (firstLine.startsWith('音效') && firstLine.length > 2 && (firstLine[2] === '：' || firstLine[2] === ':')) {
    return { type: 'sfx', action: lines.map((l) => l.replace(/^音效[：:]\s*/, '')).join('\n') }
  }
  const dialogue = firstLine.match(/^(.+?)[：:]\s*(.+)$/)
  if (dialogue) {
    const text = lines.map((l) => l.replace(/^(.+?)[：:]\s*/, '')).join('\n')
    return { type: 'dialogue', dialogue: { speaker: dialogue[1], text } }
  }
  return { type: 'action', action: lines.join('\n') }
}

async function onRewrite(beat: Beat): Promise<void> {
  message.value = ''
  const instruction = rewriteInstruction.value.trim()
  if (!instruction) {
    message.value = '请先填写改写指令。'
    return
  }
  busy.value = true
  try {
    const res = await features.rewriteBeat(props.sceneId, beat.id, instruction)
    if (!res.ok) {
      message.value = res.error
      return
    }
    const parsed = parseRewritten(res.text)
    if (!parsed) {
      message.value = '改写结果无法解析。'
      return
    }
    if (parsed.type === 'dialogue') {
      store.updateBeat(props.sceneId, beat.id, { type: parsed.type, dialogue: parsed.dialogue, action: undefined })
    } else {
      store.updateBeat(props.sceneId, beat.id, { type: parsed.type, action: parsed.action, dialogue: undefined })
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold text-ink">叙事节拍</h3>
    </div>

    <p v-if="beats.length === 0" class="text-sm text-ink-muted" data-test="beats-empty">
      暂无节拍，可添加节拍或使用 AI 生成。
    </p>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="beat in beats"
        :key="beat.id"
        class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-3"
        data-test="beat-item"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Badge :variant="typeBadgeVariant[beat.type]" data-test="beat-type">
              {{ typeLabel[beat.type] }}
            </Badge>
            <span v-if="beat.type === 'dialogue' && beat.dialogue?.speaker" class="text-xs font-medium text-ink">
              {{ beat.dialogue.speaker }}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink"
              data-test="beat-rewrite"
              :disabled="busy"
              @click="onRewrite(beat)"
            >
              AI 改写
            </button>
            <button
              type="button"
              aria-label="删除节拍"
              class="rounded-md p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-red-400"
              data-test="beat-remove"
              @click="removeBeat(beat.id)"
            >
              ✕
            </button>
          </div>
        </div>

        <template v-if="beat.type === 'dialogue'">
          <div class="flex gap-2">
            <Input
              :model-value="beat.dialogue?.speaker ?? ''"
              placeholder="角色名"
              data-test="beat-speaker"
              class="w-36 shrink-0"
              @update:model-value="setDialogueSpeaker(beat.id, $event)"
            />
            <Input
              :model-value="beat.dialogue?.text ?? ''"
              placeholder="台词"
              data-test="beat-text"
              class="min-w-0 flex-1"
              @update:model-value="setDialogueText(beat.id, $event)"
            />
          </div>
        </template>
        <Textarea
          v-else
          :model-value="beat.action ?? ''"
          :rows="2"
          :placeholder="beat.type === 'sfx' ? '音效描述' : '动作描述'"
          data-test="beat-action"
          @update:model-value="setAction(beat.id, $event)"
        />
      </li>
    </ul>

    <div class="flex items-end gap-2 rounded-lg border border-edge bg-panel p-3">
      <label class="block min-w-0 flex-1 text-xs font-medium text-ink-muted">
        新节拍类型
        <Select v-model="newType" :options="beatTypes" class="mt-1" data-test="new-type" />
      </label>
      <Button variant="primary" size="sm" class="shrink-0" data-test="beat-add" @click="addBeat">
        添加节拍
      </Button>
    </div>

    <div class="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-3">
      <span class="text-xs font-semibold text-ink">AI 改写节拍</span>
      <div class="flex gap-2">
        <Input
          v-model="rewriteInstruction"
          placeholder="改写指令，例如：让这句更有气势"
          data-test="rewrite-instruction"
          class="min-w-0 flex-1"
        />
        <p class="shrink-0 self-center text-xs text-ink-muted">点击节拍行上的「AI 改写」应用。</p>
      </div>
      <p v-if="message" class="text-xs text-amber-300" data-test="message">{{ message }}</p>
    </div>
  </div>
</template>
