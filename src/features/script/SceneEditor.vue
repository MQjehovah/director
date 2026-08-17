<script setup lang="ts">
import { computed } from 'vue'
import { useScriptStore } from '../../stores/scriptStore'
import { Input } from '../../components/ui'
import type { Scene } from '../../core/models'
import BeatList from './BeatList.vue'

const props = defineProps<{ sceneId: string }>()

const store = useScriptStore()

const scene = computed(() => store.scenes.find((s) => s.id === props.sceneId))

function setField(patch: Partial<Omit<Scene, 'id'>>): void {
  if (!scene.value) return
  store.updateScene(scene.value.id, patch)
}
</script>

<template>
  <div v-if="scene" class="flex flex-col gap-4 p-4">
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label class="block text-xs font-medium text-ink-muted">
        场次标题
        <Input
          class="mt-1"
          :model-value="scene.title ?? ''"
          placeholder="未命名场次"
          data-test="scene-title"
          @update:model-value="setField({ title: $event || undefined })"
        />
      </label>
      <label class="block text-xs font-medium text-ink-muted">
        地点
        <Input
          class="mt-1"
          :model-value="scene.location ?? ''"
          placeholder="例如：屋顶"
          data-test="scene-location"
          @update:model-value="setField({ location: $event || undefined })"
        />
      </label>
      <label class="block text-xs font-medium text-ink-muted">
        时间
        <Input
          class="mt-1"
          :model-value="scene.timeOfDay ?? ''"
          placeholder="例如：夜晚"
          data-test="scene-time"
          @update:model-value="setField({ timeOfDay: $event || undefined })"
        />
      </label>
    </div>
    <BeatList :scene-id="scene.id" />
  </div>
</template>
