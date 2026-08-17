<script setup lang="ts">
import { ref } from 'vue'
import { useProjects } from '../../features/projects/useProjects'
import { Button, Dialog, Input } from '../ui'

const emit = defineEmits<{
  (e: 'settings'): void
}>()

const projects = useProjects()

const open = ref(false)
const newName = ref('')
const renameId = ref<string | null>(null)
const renameValue = ref('')
const busy = ref(false)
const error = ref('')

async function openDialog(): Promise<void> {
  error.value = ''
  await projects.refreshList()
  open.value = true
}

async function onCreate(): Promise<void> {
  error.value = ''
  const name = newName.value.trim()
  if (!name) {
    error.value = '请输入项目名称。'
    return
  }
  busy.value = true
  try {
    await projects.createProject(name)
    newName.value = ''
    open.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function onSwitch(id: string): Promise<void> {
  error.value = ''
  busy.value = true
  try {
    await projects.switchProject(id)
    open.value = false
  } finally {
    busy.value = false
  }
}

async function onRename(id: string): Promise<void> {
  const p = projects.projects.value.find((x) => x.id === id)
  renameId.value = id
  renameValue.value = p?.name ?? ''
}

async function onRenameConfirm(): Promise<void> {
  error.value = ''
  if (!renameId.value) return
  busy.value = true
  try {
    await projects.renameProject(renameId.value, renameValue.value.trim())
    renameId.value = null
  } finally {
    busy.value = false
  }
}

async function onDelete(id: string): Promise<void> {
  error.value = ''
  busy.value = true
  try {
    await projects.deleteProject(id)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center gap-4 border-b border-edge bg-panel px-4"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-xs font-bold text-zinc-950"
      >
        导
      </span>
      <button
        type="button"
        class="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-ink transition-colors hover:text-amber-300"
        data-test="topbar-project"
        title="项目管理"
        @click="openDialog"
      >
        <span class="truncate">{{ projects.currentProject.value?.name ?? '未命名项目' }}</span>
        <span class="shrink-0 text-xs text-ink-muted">▾</span>
      </button>
    </div>

    <div class="ml-auto flex items-center gap-4">
      <span class="hidden text-xs text-ink-muted md:inline">
        {{ projects.projects.value.length }} 个项目
      </span>
      <span class="flex items-center gap-1.5 text-xs text-ink-muted">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Provider 就绪
      </span>
      <Button variant="ghost" size="sm" data-test="topbar-settings" @click="emit('settings')">设置</Button>
      <Button variant="primary" size="sm">导出</Button>
    </div>

    <Dialog :open="open" title="项目管理" @update:open="open = $event">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink-muted">当前项目</span>
          <p class="text-sm font-semibold text-ink" data-test="current-project">
            {{ projects.currentProject.value?.name ?? '未命名项目' }}
          </p>
        </div>

        <div v-if="projects.projects.value.length > 0" class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink-muted">全部项目</span>
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="p in projects.projects.value"
              :key="p.id"
              class="flex items-center justify-between gap-2 rounded-md border border-edge bg-zinc-900/60 px-3 py-2"
              data-test="project-item"
            >
              <button
                type="button"
                class="min-w-0 truncate text-sm text-ink transition-colors hover:text-amber-300"
                :class="p.id === projects.currentProjectId.value ? 'font-semibold text-amber-300' : ''"
                data-test="project-switch"
                @click="onSwitch(p.id)"
              >
                {{ p.name }}
              </button>
              <div class="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" data-test="project-rename" @click="onRename(p.id)">
                  重命名
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-red-300"
                  data-test="project-delete"
                  @click="onDelete(p.id)"
                >
                  删除
                </Button>
              </div>
            </li>
          </ul>
        </div>

        <template v-if="renameId">
          <div class="flex items-end gap-2">
            <label class="block min-w-0 flex-1 text-xs font-medium text-ink-muted">
              新名称
              <Input v-model="renameValue" class="mt-1" data-test="rename-input" />
            </label>
            <Button size="sm" variant="primary" data-test="rename-confirm" @click="onRenameConfirm">
              保存
            </Button>
            <Button size="sm" variant="ghost" @click="renameId = null">取消</Button>
          </div>
        </template>

        <div class="flex items-end gap-2 border-t border-edge pt-4">
          <label class="block min-w-0 flex-1 text-xs font-medium text-ink-muted">
            新建项目
            <Input v-model="newName" class="mt-1" placeholder="项目名称" data-test="new-project-input" />
          </label>
          <Button size="sm" variant="primary" :disabled="busy" data-test="new-project-create" @click="onCreate">
            新建
          </Button>
        </div>

        <p v-if="error" class="text-xs text-red-400" data-test="project-error">{{ error }}</p>
      </div>
    </Dialog>
  </header>
</template>
