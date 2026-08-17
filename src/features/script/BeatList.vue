<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useScriptFeatures } from './useScriptFeatures'
import { Badge, Button, Input, Select, Textarea } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import type { Beat } from '../../core/models'

const props = defineProps<{ sceneId: string }>()

const store = useScriptStore()
const characterStore = useCharacterStore()
const features = useScriptFeatures()

const scene = computed(() => store.scenes.find((s) => s.id === props.sceneId))
const beats = computed<Beat[]>(() => scene.value?.beats ?? [])
const characterNames = computed<string[]>(() => [
  ...new Set(characterStore.characters.map((c) => c.name).filter(Boolean)),
])

const beatTypes: SelectOption[] = [
  { value: 'dialogue', label: '对话' },
  { value: 'action', label: '动作' },
  { value: 'sfx', label: '音效' },
]

const busy = ref(false)
const rewritingBeatId = ref<string | null>(null)
const rewriteInstructions = ref<Record<string, string>>({})
const message = ref<{ beatId: string; text: string } | null>(null)

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
  store.addBeat(props.sceneId, {
    type: 'dialogue',
    dialogue: { speaker: '角色', text: '' },
  })
}

function removeBeat(beatId: string): void {
  store.removeBeat(props.sceneId, beatId)
}

function beatById(beatId: string): Beat | undefined {
  return beats.value.find((b) => b.id === beatId)
}

function setBeatType(beatId: string, value: string): void {
  const beat = beatById(beatId)
  if (!beat) return
  const type = value as Beat['type']
  if (type === 'dialogue') {
    store.updateBeat(props.sceneId, beatId, {
      type: 'dialogue',
      dialogue: { speaker: beat.dialogue?.speaker ?? '角色', text: beat.dialogue?.text ?? beat.action ?? '' },
      action: undefined,
    })
  } else {
    store.updateBeat(props.sceneId, beatId, {
      type,
      action: beat.action ?? beat.dialogue?.text ?? '',
      dialogue: undefined,
    })
  }
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

function toggleRewrite(beatId: string): void {
  rewritingBeatId.value = rewritingBeatId.value === beatId ? null : beatId
  message.value = null
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
  message.value = null
  const instruction = (rewriteInstructions.value[beat.id] ?? '').trim()
  if (!instruction) {
    message.value = { beatId: beat.id, text: '请先填写改写指令。' }
    return
  }
  busy.value = true
  try {
    const res = await features.rewriteBeat(props.sceneId, beat.id, instruction)
    if (!res.ok) {
      message.value = { beatId: beat.id, text: res.error }
      return
    }
    const parsed = parseRewritten(res.text)
    if (!parsed) {
      message.value = { beatId: beat.id, text: '改写结果无法解析。' }
      return
    }
    if (parsed.type === 'dialogue') {
      store.updateBeat(props.sceneId, beat.id, { type: parsed.type, dialogue: parsed.dialogue, action: undefined })
    } else {
      store.updateBeat(props.sceneId, beat.id, { type: parsed.type, action: parsed.action, dialogue: undefined })
    }
    message.value = { beatId: beat.id, text: '改写已应用。' }
    rewritingBeatId.value = null
    rewriteInstructions.value[beat.id] = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="beats.length === 0" class="text-sm text-ink-muted" data-test="beats-empty">
      暂无节拍，点击「添加节拍」创建。
    </p>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="beat in beats"
        :key="beat.id"
        class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-3"
        data-test="beat-item"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <Select
              :model-value="beat.type"
              :options="beatTypes"
              class="w-24 shrink-0"
              data-test="beat-type-select"
              @update:model-value="setBeatType(beat.id, $event)"
            />
            <Badge :variant="typeBadgeVariant[beat.type]" class="shrink-0" data-test="beat-type">
              {{ typeLabel[beat.type] }}
            </Badge>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink"
              data-test="beat-rewrite"
              :disabled="busy"
              @click="toggleRewrite(beat.id)"
            >
              ✨ AI 改写
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
              placeholder="选择或输入角色"
              data-test="beat-speaker"
              list="beat-character-names"
              class="w-28 shrink-0"
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

        <div
          v-if="rewritingBeatId === beat.id"
          class="flex flex-col gap-2 rounded-md border border-edge bg-panel p-2"
          data-test="rewrite-panel"
        >
          <div class="flex gap-2">
            <Input
              v-model="rewriteInstructions[beat.id]"
              placeholder="改写指令，例如：让这句更有气势"
              data-test="rewrite-instruction"
              class="min-w-0 flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              class="shrink-0"
              :disabled="busy"
              data-test="rewrite-apply"
              @click="onRewrite(beat)"
            >
              应用
            </Button>
          </div>
          <p
            v-if="message && message.beatId === beat.id"
            class="text-xs text-amber-300"
            data-test="rewrite-message"
          >
            {{ message.text }}
          </p>
        </div>
      </li>
    </ul>

    <datalist id="beat-character-names">
      <option v-for="name in characterNames" :key="name" :value="name" />
    </datalist>

    <Button
      variant="outline"
      size="sm"
      class="w-full"
      data-test="beat-add"
      @click="addBeat"
    >
      + 添加节拍
    </Button>
  </div>
</template>
