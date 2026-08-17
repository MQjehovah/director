<script setup lang="ts">
import { Button } from '../ui'

defineProps<{
  projectName?: string
}>()

const emit = defineEmits<{
  (e: 'settings'): void
}>()
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center gap-4 border-b border-edge bg-panel px-4"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-xs font-bold text-zinc-950"
      >
        导
      </span>
      <span class="truncate text-sm font-semibold">{{ projectName }}</span>
      <span class="hidden text-xs text-ink-muted sm:inline">未命名项目</span>
    </div>

    <div class="ml-auto flex items-center gap-4">
      <span class="hidden text-xs text-ink-muted md:inline">未保存</span>
      <span class="flex items-center gap-1.5 text-xs text-ink-muted">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Provider 就绪
      </span>
      <Button variant="ghost" size="sm" data-test="topbar-settings" @click="emit('settings')">设置</Button>
      <Button variant="primary" size="sm">导出</Button>
    </div>
  </header>
</template>
