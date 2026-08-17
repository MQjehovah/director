<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    type?: 'text' | 'password' | 'number'
    disabled?: boolean
  }>(),
  {
    type: 'text',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <input
    :value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    class="h-9 w-full rounded-md border border-edge bg-zinc-900/60 px-3 text-sm text-ink
      placeholder:text-zinc-500 transition-colors focus:border-amber-400/60
      focus:outline-none focus:ring-2 focus:ring-amber-400/30 disabled:opacity-50"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
