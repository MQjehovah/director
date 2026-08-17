<script setup lang="ts">
import { ref } from 'vue'
import { useCharacterStore } from '../../stores/characterStore'
import CharacterGrid from './CharacterGrid.vue'
import CharacterEditor from './CharacterEditor.vue'

const store = useCharacterStore()

const selectedId = ref<string | undefined>(undefined)

function addNew(): void {
  const c = store.addCharacter({ name: '新角色' })
  selectedId.value = c.id
}

function openEditor(id: string): void {
  selectedId.value = id
}

function closeEditor(): void {
  selectedId.value = undefined
}
</script>

<template>
  <div class="flex h-full gap-4 p-4">
    <div class="relative min-w-0 flex-1 overflow-y-auto">
      <CharacterGrid @select="openEditor" @add="addNew" />
      <CharacterEditor
        v-if="selectedId"
        :key="selectedId"
        :character-id="selectedId"
        class="absolute inset-y-0 right-0 z-10 shadow-2xl"
        @close="closeEditor"
      />
    </div>
  </div>
</template>
