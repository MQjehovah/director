<script setup lang="ts">
export interface SelectOption {
  value: string
  label: string
}

defineProps<{
  modelValue?: string
  options: SelectOption[]
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <select
    :value="modelValue"
    class="h-9 w-full rounded-md border border-edge bg-zinc-900/60 px-3 text-sm text-ink
      transition-colors focus:border-amber-400/60 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </option>
  </select>
</template>
