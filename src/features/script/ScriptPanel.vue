<script setup lang="ts">
import { ref } from 'vue'
import { useScriptStore } from '../../stores/scriptStore'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useScriptFeatures } from './useScriptFeatures'
import { Button, Dialog, Input, Textarea } from '../../components/ui'
import SceneEditor from './SceneEditor.vue'

const store = useScriptStore()
const features = useScriptFeatures()

const selectedId = ref<string | undefined>(undefined)
const aiOpen = ref(false)
const idea = ref('')
const markdown = ref('')
const busy = ref(false)
const message = ref('')
const cutMessage = ref('')

function selectScene(id: string): void {
  selectedId.value = id
  cutMessage.value = ''
}

function addScene(): void {
  const scene = store.addScene()
  selectedId.value = scene.id
  cutMessage.value = ''
}

function removeScene(id: string): void {
  store.removeScene(id)
  if (selectedId.value === id) selectedId.value = undefined
  cutMessage.value = ''
}

async function onGenerate(): Promise<void> {
  message.value = ''
  const ideaText = idea.value.trim()
  if (!ideaText) {
    message.value = '请先填写剧本灵感。'
    return
  }
  busy.value = true
  try {
    const res = await features.generateScriptFromIdea(ideaText)
    if (!res.ok) {
      message.value = res.error
      return
    }
    const script = features.importScript(res.text)
    if (script.scenes.length === 0) {
      message.value = '生成结果没有可识别的场次。'
      return
    }
    selectedId.value = script.scenes[0].id
    message.value = `已生成剧本，共 ${script.scenes.length} 个场次。`
  } finally {
    busy.value = false
  }
}

function onImport(): void {
  message.value = ''
  const md = markdown.value.trim()
  if (!md) {
    message.value = '请先粘贴 Markdown 剧本。'
    return
  }
  const script = features.importScript(md)
  selectedId.value = script.scenes[0]?.id
  message.value =
    script.scenes.length > 0 ? `已导入 ${script.scenes.length} 个场次。` : '未解析出任何场次。'
}

function onCutScene(): void {
  cutMessage.value = ''
  if (!selectedId.value) {
    cutMessage.value = '请先选择一个场次。'
    return
  }
  const scene = store.scenes.find((s) => s.id === selectedId.value)
  if (!scene) return
  const beatIds = new Set(scene.beats.map((b) => b.id))
  const storyboard = useStoryboardStore()
  const hasShots = storyboard.shots.some((s) => s.beatRef && beatIds.has(s.beatRef))
  if (hasShots) {
    cutMessage.value = '该场次已切分为镜头，如需重新切分请先删除现有镜头。'
    return
  }
  const shots = features.cutSceneToShots(selectedId.value)
  cutMessage.value =
    shots.length > 0 ? `已切分为 ${shots.length} 个镜头。` : '该场次没有节拍，无法切分。'
}
</script>

<template>
  <div class="flex h-full">
    <aside class="flex w-64 shrink-0 flex-col border-r border-edge bg-panel">
      <header class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 class="text-sm font-semibold text-ink">场次</h2>
        <Button variant="primary" size="sm" data-test="scene-add" @click="addScene">
          添加场次
        </Button>
      </header>
      <div class="flex-1 overflow-y-auto p-2">
        <div
          v-for="scene in store.scenes"
          :key="scene.id"
          class="flex w-full items-center gap-1 rounded-md transition-colors"
          :class="scene.id === selectedId ? 'bg-zinc-800' : 'hover:bg-zinc-900'"
        >
          <button
            type="button"
            class="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
            :class="scene.id === selectedId ? 'text-ink' : 'text-ink-muted hover:text-ink'"
            data-test="scene-item"
            @click="selectScene(scene.id)"
          >
            {{ scene.title || '未命名场次' }}
          </button>
          <button
            type="button"
            aria-label="删除场次"
            class="mr-1 rounded p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-red-400"
            data-test="scene-remove"
            @click="removeScene(scene.id)"
          >
            ✕
          </button>
        </div>
        <p v-if="store.scenes.length === 0" class="px-3 py-2 text-xs text-ink-muted">
          暂无场次，可点击「添加场次」创建，或通过右上角 AI 导入。
        </p>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex shrink-0 items-center justify-between border-b border-edge bg-panel px-4 py-3">
        <h1 class="text-sm font-semibold text-ink">剧本</h1>
        <div class="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            :disabled="!selectedId || busy"
            data-test="cut-btn"
            @click="onCutScene"
          >
            一键切分为镜头
          </Button>
          <button
            type="button"
            aria-label="AI 辅助"
            title="AI 辅助"
            data-test="ai-btn"
            class="rounded-md px-1.5 py-1 text-sm text-amber-300/90 transition-colors hover:bg-zinc-800 hover:text-amber-300"
            @click="aiOpen = true"
          >
            ✨
          </button>
        </div>
      </header>

      <p v-if="cutMessage" class="shrink-0 border-b border-edge bg-panel px-4 py-2 text-xs text-amber-300" data-test="message">
        {{ cutMessage }}
      </p>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <SceneEditor v-if="selectedId" :key="selectedId" :scene-id="selectedId" />
        <p v-else class="p-6 text-sm text-ink-muted" data-test="empty">
          选择或添加一个场次开始编辑。
        </p>
      </div>
    </div>

    <Dialog :open="aiOpen" title="AI 辅助" @update:open="aiOpen = $event">
      <div class="flex flex-col gap-5">
        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold text-ink">AI 生成剧本</h3>
          <Input v-model="idea" placeholder="剧本灵感，例如：都市少年与 AI 伙伴的冒险" data-test="idea-input" />
          <div class="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              :disabled="busy"
              data-test="ai-generate"
              @click="onGenerate"
            >
              生成剧本
            </Button>
          </div>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-semibold text-ink">导入 Markdown</h3>
          <Textarea
            v-model="markdown"
            :rows="4"
            placeholder="粘贴 Markdown 剧本（# 场景 / 角色：台词 / 动作：… / 音效：…）"
            data-test="markdown-input"
            class="font-mono text-xs"
          />
          <div class="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              :disabled="busy"
              data-test="import-btn"
              @click="onImport"
            >
              导入
            </Button>
          </div>
        </section>

        <p v-if="message" class="text-xs text-amber-300" data-test="ai-message">{{ message }}</p>
      </div>
    </Dialog>
  </div>
</template>
