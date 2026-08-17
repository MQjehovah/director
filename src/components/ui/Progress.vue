<script setup lang="ts">
withDefaults(
  defineProps<{
    value: number
    max?: number
    variant?: 'neutral' | 'danger'
  }>(),
  {
    max: 100,
    variant: 'neutral',
  },
)
</script>

<template>
  <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" :aria-valuenow="value" :aria-valuemin="0" :aria-valuemax="max">
    <div
      class="h-full rounded-full transition-all duration-200"
      :class="variant === 'danger' ? 'bg-red-500' : 'bg-amber-400'"
      :style="{ width: `${Math.min(Math.max(value, 0), max) / max * 100}%` }"
    />
  </div>
</template>
