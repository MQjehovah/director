<script setup lang="ts">
import { watch } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import { useAssetUrls } from '../shared/useAssetUrls'
import { Badge, Button } from '../../components/ui'

const store = useCharacterStore()
const { resolveAsset, urlOf } = useAssetUrls()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'add'): void
}>()

watch(
  () => store.characters.map((c) => c.referenceImages[0]),
  (ids) => {
    for (const id of ids) if (id) void resolveAsset(id)
  },
  { immediate: true, deep: true },
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-ink">角色</h2>
      <Button variant="primary" size="sm" data-test="char-add" @click="emit('add')">添加角色</Button>
    </div>

    <p v-if="store.characters.length === 0" class="text-sm text-ink-muted" data-test="empty">
      暂无角色，点击「添加角色」创建。
    </p>

    <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="c in store.characters"
        :key="c.id"
        type="button"
        data-test="char-card"
        class="flex flex-col gap-2 rounded-lg border border-edge bg-raised p-4 text-left transition-colors hover:border-zinc-600"
        @click="emit('select', c.id)"
      >
        <span class="text-sm font-semibold text-ink">{{ c.name }}</span>
        <p v-if="c.appearance" class="line-clamp-2 text-xs leading-relaxed text-ink-muted">
          {{ c.appearance }}
        </p>
        <div v-if="c.referenceImages.length > 0" class="flex gap-1">
          <img
            v-if="urlOf(c.referenceImages[0])"
            :src="urlOf(c.referenceImages[0])"
            class="h-10 w-10 rounded border border-edge bg-zinc-800 object-cover"
            alt=""
          />
          <span v-else class="text-[10px] text-ink-muted">图 {{ c.referenceImages[0] }}</span>
        </div>
        <div v-if="c.tags.length > 0" class="flex flex-wrap gap-1">
          <Badge v-for="t in c.tags" :key="t">{{ t }}</Badge>
        </div>
      </button>
    </div>
  </div>
</template>
