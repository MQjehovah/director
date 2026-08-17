<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    rows?: number
  }>(),
  {
    rows: 4,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <textarea
    :value="modelValue"
    :placeholder="placeholder"
    :rows="rows"
    class="w-full resize-y rounded-md border border-edge bg-zinc-900/60 px-3 py-2 text-sm leading-relaxed text-ink
      placeholder:text-zinc-500 transition-colors focus:border-amber-400/60
      focus:outline-none focus:ring-2 focus:ring-amber-400/20"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
