<script setup lang="ts">
interface NavItem {
  key: string
  label: string
}

defineProps<{
  active: string
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()

const items: NavItem[] = [
  { key: 'characters', label: '角色' },
  { key: 'script', label: '剧本' },
  { key: 'storyboard', label: '分镜' },
  { key: 'film', label: '成片' },
  { key: 'tasks', label: '任务' },
  { key: 'pipeline', label: '全流程' },
]
</script>

<template>
  <nav
    class="flex w-40 shrink-0 flex-col gap-1 overflow-y-auto border-r border-edge bg-panel p-2"
    aria-label="模块导航"
  >
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="rounded-md px-3 py-2 text-left text-sm transition-colors"
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
