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
  <label class="inline-flex cursor-pointer select-none items-center gap-2" :class="{ 'opacity-50': disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      class="h-4 w-4 accent-amber-400"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="label" class="text-sm text-ink">{{ label }}</span>
  </label>
</template>
