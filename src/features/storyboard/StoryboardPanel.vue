<script setup lang="ts">
import { ref } from 'vue'
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useShotActions } from './useShotActions'
import { Button } from '../../components/ui'
import ShotGrid from './ShotGrid.vue'
import ShotTimeline from './ShotTimeline.vue'
import ShotEditor from './ShotEditor.vue'

const store = useStoryboardStore()
const actions = useShotActions()

const view = ref<'grid' | 'timeline'>('grid')
const selectedShotId = ref<string | undefined>(undefined)

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
      暂无镜头，可从剧本模块「一键切分为镜头」生成。
    </p>

    <div v-else class="flex min-h-0 flex-1 gap-4">
      <div class="min-w-0 flex-1 overflow-y-auto">
        <ShotGrid v-if="view === 'grid'" :selected-shot-id="selectedShotId" @select="selectShot" />
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
  </div>
</template>
