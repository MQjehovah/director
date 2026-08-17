<script setup lang="ts">
defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
</script>

<template>
  <label
    class="group inline-flex cursor-pointer select-none items-center gap-2"
    :class="{ 'opacity-50': disabled }"
  >
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      class="sr-only"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span
      class="sw-track relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-edge bg-zinc-800 transition-colors group-has-[:checked]:border-amber-400/60 group-has-[:checked]:bg-amber-400/80"
      aria-hidden="true"
    >
      <span
        class="sw-thumb h-3.5 w-3.5 rounded-full bg-zinc-300 shadow transition-transform group-has-[:checked]:translate-x-4 group-has-[:checked]:bg-zinc-950"
      />
    </span>
    <span v-if="label" class="text-sm text-ink">{{ label }}</span>
  </label>
</template>
