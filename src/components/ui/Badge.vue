<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  }>(),
  {
    variant: 'neutral',
  },
)

const styles: Record<string, string> = {
  neutral: 'bg-zinc-800 text-zinc-300',
  success: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-red-500/15 text-red-300',
  info: 'bg-sky-500/15 text-sky-300',
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
    :class="styles[variant]"
  >
    <slot />
  </span>
</template>
