<script setup lang="ts">
defineProps<{
  running: number
  done: number
  failed: number
}>()
</script>

<template>
  <footer
    class="flex h-8 shrink-0 items-center gap-5 overflow-hidden border-t border-edge bg-panel px-4 text-xs text-ink-muted"
  >
    <span class="flex items-center gap-1.5">
      <span
        :class="running > 0 ? 'bg-amber-400' : 'bg-zinc-600'"
        class="h-1.5 w-1.5 rounded-full"
      />
      任务队列
    </span>
    <span>
      {{ running > 0 ? `${running} 个进行中` : '空闲' }}
      <template v-if="done > 0 || failed > 0"> · {{ done }} 完成 · {{ failed }} 失败</template>
    </span>
    <span class="ml-auto hidden sm:inline">就绪</span>
  </footer>
</template>
