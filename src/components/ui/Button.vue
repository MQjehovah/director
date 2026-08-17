<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'outline' | 'ghost'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
  }>(),
  {
    variant: 'outline',
    size: 'md',
    type: 'button',
  },
)
</script>

<template>
  <button
    :type="type"
    class="inline-flex select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors
      disabled:pointer-events-none disabled:opacity-50
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    :class="[
      size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-4 text-sm',
      variant === 'primary'
        ? 'bg-accent text-zinc-950 hover:bg-amber-300'
        : variant === 'ghost'
          ? 'text-ink-muted hover:bg-zinc-800 hover:text-ink'
          : 'border border-edge text-ink-muted hover:border-zinc-600 hover:text-ink',
    ]"
  >
    <slot />
  </button>
</template>
