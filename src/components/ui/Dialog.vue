<script setup lang="ts">
import { watch } from 'vue'

const props = defineProps<{
  open: boolean
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
}>()

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
  },
)

function close(): void {
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div class="absolute inset-0 bg-black/70" @click="close" />
      <div
        class="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
      >
        <header
          class="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3"
        >
          <h2 class="text-sm font-semibold text-ink">{{ title }}</h2>
          <button
            type="button"
            class="rounded-md p-1 text-ink-muted transition-colors hover:bg-zinc-800 hover:text-ink"
            aria-label="关闭"
            @click="close"
          >
            ✕
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-3"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
