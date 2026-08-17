import { defineStore } from 'pinia'
import { ref } from 'vue'
import { CharacterSchema } from '../core/models'
import type { Character } from '../core/models'
import { newId } from '../core/utils/id'

export type CharacterInput = Omit<Partial<Character>, 'id' | 'name'> & { name: string }

export const useCharacterStore = defineStore('character', () => {
  const characters = ref<Character[]>([])

  function addCharacter(data: CharacterInput): Character {
    const character = CharacterSchema.parse({ id: newId('char'), ...data })
    characters.value.push(character)
    return character
  }

  function updateCharacter(id: string, patch: Partial<Omit<Character, 'id'>>): void {
    characters.value = characters.value.map((c) =>
      c.id === id ? CharacterSchema.parse({ ...c, ...patch, id }) : c,
    )
  }

  function removeCharacter(id: string): void {
    characters.value = characters.value.filter((c) => c.id !== id)
  }

  function getCharacter(id: string): Character | undefined {
    return characters.value.find((c) => c.id === id)
  }

  function findByTag(tag: string): Character[] {
    return characters.value.filter((c) => c.tags.includes(tag))
  }

  return { characters, addCharacter, updateCharacter, removeCharacter, getCharacter, findByTag }
})
