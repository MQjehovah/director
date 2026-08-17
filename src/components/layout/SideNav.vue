<script setup lang="ts">
import { MODULES } from './modules'
import type { ModuleKey } from './modules'

defineProps<{
  active: string
}>()

const emit = defineEmits<{
  (e: 'select', key: ModuleKey): void
}>()
</script>

<template>
  <nav
    class="flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-r border-edge bg-panel p-2"
    aria-label="模块导航"
  >
    <button
      v-for="item in MODULES"
      :key="item.key"
      type="button"
      class="rounded-md px-3 py-2 text-left text-sm transition-colors"
      :aria-current="item.key === active ? 'page' : undefined"
      :class="
        item.key === active
          ? 'bg-raised font-medium text-ink'
          : 'text-ink-muted hover:bg-zinc-800/60 hover:text-ink'
      "
      @click="emit('select', item.key)"
    >
      {{ item.label }}
    </button>
  </nav>
</template>
