<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useScriptStore } from '../../stores/scriptStore'
import { useShotActions } from './useShotActions'
import { Button, Dialog, Select } from '../../components/ui'
import type { SelectOption } from '../../components/ui'
import type { Shot } from '../../core/models'
import ShotGrid from './ShotGrid.vue'
import ShotTimeline from './ShotTimeline.vue'
import ShotEditor from './ShotEditor.vue'

const store = useStoryboardStore()
const scriptStore = useScriptStore()
const actions = useShotActions()

const view = ref<'grid' | 'timeline'>('grid')
const selectedShotId = ref<string | undefined>(undefined)

const addOpen = ref(false)
const sourceSceneId = ref('')
const sourceBeatId = ref('')
const shotType = ref<Shot['shotType']>('image')

const sceneOptions = computed<SelectOption[]>(() => [
  ...scriptStore.scenes.map((s) => ({ value: s.id, label: s.title || '未命名场次' })),
])

const beatOptions = computed<SelectOption[]>(() => {
  const scene = scriptStore.scenes.find((s) => s.id === sourceSceneId.value)
  return (scene?.beats ?? []).map((b, i) => ({
    value: b.id,
    label: `${i + 1}. ${beatText(b.type, b)}`,
  }))
})

// 按场次分组的镜头：每场一组 + 无场次镜头一组
const sceneGroups = computed<Array<{ sceneId: string | null; title: string; shots: Shot[] }>>(() => {
  const groups: Array<{ sceneId: string | null; title: string; shots: Shot[] }> = []
  for (const scene of scriptStore.scenes) {
    const shots = store.shotsForScene(scene.id)
    if (shots.length > 0) {
      groups.push({ sceneId: scene.id, title: scene.title || '未命名场次', shots })
    }
  }
  const unassigned = store.shots.filter((s) => !s.sceneId)
  if (unassigned.length > 0) {
    groups.push({ sceneId: null, title: '未归入场次', shots: unassigned })
  }
  return groups
})

function beatText(type: string, b: { dialogue?: { speaker?: string; text?: string }; action?: string }): string {
  if (type === 'dialogue') return `${b.dialogue?.speaker ?? ''}：${b.dialogue?.text ?? ''}`
  if (type === 'sfx') return `音效：${b.action ?? ''}`
  return b.action ?? ''
}

function openAdd(sceneId?: string): void {
  sourceSceneId.value = sceneId ?? scriptStore.scenes[0]?.id ?? ''
  sourceBeatId.value = ''
  shotType.value = 'image'
  addOpen.value = true
}

function onAdd(): void {
  const sceneId = sourceSceneId.value || undefined
  if (sourceBeatId.value) {
    const scene = scriptStore.scenes.find((s) => s.id === sourceSceneId.value)
    const beat = scene?.beats.find((b) => b.id === sourceBeatId.value)
    if (beat) {
      const shot = store.addShot({
        shotType: shotType.value,
        sceneId,
        beatRef: beat.id,
        prompt: beatText(beat.type, beat) || undefined,
      })
      selectedShotId.value = shot.id
    }
  } else {
    const shot = store.addShot({ shotType: shotType.value, sceneId })
    selectedShotId.value = shot.id
  }
  addOpen.value = false
}

async function onGenerateAll(): Promise<void> {
  for (const shot of [...store.shots]) {
    if (shot.mediaAssets.length > 0) continue
    try {
      await actions.generateMedia(shot.id)
    } catch {
      // keep generating the remaining shots even if one fails
    }
  }
}

function onClear(): void {
  for (const shot of [...store.shots]) {
    void actions.cancelGeneration(shot.id)
    store.removeShot(shot.id)
  }
  selectedShotId.value = undefined
}

function selectShot(id: string): void {
  selectedShotId.value = id
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <Button
          size="sm"
          :variant="view === 'grid' ? 'primary' : 'outline'"
          data-test="view-grid"
          @click="view = 'grid'"
        >
          分镜网格
        </Button>
        <Button
          size="sm"
          :variant="view === 'timeline' ? 'primary' : 'outline'"
          data-test="view-timeline"
          @click="view = 'timeline'"
        >
          时间轴
        </Button>
        <Button variant="primary" size="sm" data-test="add-shot" @click="openAdd()">
          + 添加镜头
        </Button>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          data-test="gen-all"
          :disabled="store.shots.length === 0"
          @click="onGenerateAll"
        >
          生成全部
        </Button>
        <Button size="sm" data-test="clear-all" :disabled="store.shots.length === 0" @click="onClear">
          清空
        </Button>
      </div>
    </div>

    <p v-if="store.shots.length === 0" class="text-sm text-ink-muted" data-test="empty">
      暂无镜头。可点「添加镜头」从剧本节拍创建，或在剧本模块「一键切分为镜头」。
    </p>

    <div v-else class="flex min-h-0 flex-1 gap-4">
      <div class="min-w-0 flex-1 overflow-y-auto">
        <template v-if="view === 'grid'">
          <div v-for="group in sceneGroups" :key="group.sceneId ?? 'unassigned'" class="mb-6">
            <div class="mb-2 flex items-center justify-between">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {{ group.title }}
              </h3>
              <Button
                size="sm"
                variant="outline"
                data-test="add-shot-to-scene"
                @click="openAdd(group.sceneId ?? undefined)"
              >
                + 添加镜头
              </Button>
            </div>
            <ShotGrid
              :shots="group.shots"
              :selected-shot-id="selectedShotId"
              @select="selectShot"
            />
          </div>
        </template>
        <ShotTimeline v-else :selected-shot-id="selectedShotId" @select="selectShot" />
      </div>
      <ShotEditor
        v-if="selectedShotId"
        :key="selectedShotId"
        :shot-id="selectedShotId"
        @close="selectedShotId = undefined"
        @remove="selectedShotId = undefined"
      />
    </div>

    <Dialog :open="addOpen" title="添加镜头" @update:open="addOpen = $event">
      <div class="flex flex-col gap-4">
        <label class="block text-xs font-medium text-ink-muted">
          来源节拍（可选）
          <Select
            v-model="sourceSceneId"
            :options="sceneOptions"
            class="mt-1"
            placeholder="选择场次"
            data-test="add-scene"
          />
        </label>
        <label v-if="sourceSceneId" class="block text-xs font-medium text-ink-muted">
          节拍（留空则为空白镜头）
          <Select
            v-model="sourceBeatId"
            :options="beatOptions"
            class="mt-1"
            placeholder="选择节拍（可选）"
            data-test="add-beat"
          />
        </label>
        <label class="block text-xs font-medium text-ink-muted">
          镜头类型
          <Select
            v-model="shotType"
            :options="[
              { value: 'image', label: '静态图' },
              { value: 'video', label: '视频' },
            ]"
            class="mt-1"
            data-test="add-shot-type"
          />
        </label>
        <p class="text-xs text-ink-muted">
          从节拍创建时自动填入镜头提示词；留空创建空白镜头，之后可在镜头详情中编辑。
        </p>
        <div class="flex justify-end">
          <Button variant="primary" size="sm" data-test="add-shot-confirm" @click="onAdd">
            创建
          </Button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
