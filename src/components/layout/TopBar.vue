<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjects } from '../../features/projects/useProjects'
import { useJobStore } from '../../stores/jobStore'
import { jobStatusInfo, jobTypeLabel } from '../../features/jobs/jobMeta'
import { Badge, Button, Dialog, Input, Progress } from '../ui'

const emit = defineEmits<{
  (e: 'settings'): void
  (e: 'tasks'): void
}>()

const projects = useProjects()
const jobStore = useJobStore()

const open = ref(false)
const newName = ref('')
const renameId = ref<string | null>(null)
const renameValue = ref('')
const busy = ref(false)
const error = ref('')
const taskOpen = ref(false)

const activeJobs = computed(() =>
  jobStore.jobs.filter((j) => j.status === 'queued' || j.status === 'running'),
)
const doneCount = computed(() => jobStore.jobs.filter((j) => j.status === 'done').length)
const failedCount = computed(() => jobStore.jobs.filter((j) => j.status === 'failed').length)

function openTasks(): void {
  taskOpen.value = false
  emit('tasks')
}

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
      <div class="relative" data-test="task-menu">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md border border-edge px-2 py-1 text-xs text-ink-muted transition-colors hover:border-zinc-600 hover:text-ink"
          data-test="task-toggle"
          @click="taskOpen = !taskOpen"
        >
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="activeJobs.length > 0 ? 'bg-amber-400' : 'bg-zinc-600'"
          />
          {{ activeJobs.length > 0 ? `任务 ${activeJobs.length}` : '任务' }}
          <span class="text-[10px] text-ink-muted">▾</span>
        </button>

        <div
          v-if="taskOpen"
          class="fixed inset-0 z-40"
          data-test="task-backdrop"
          @click="taskOpen = false"
        />

        <div
          v-if="taskOpen"
          class="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-edge bg-panel shadow-2xl"
          data-test="task-panel"
        >
          <div class="max-h-80 overflow-y-auto p-2">
            <p
              v-if="activeJobs.length === 0"
              class="px-2 py-3 text-xs text-ink-muted"
              data-test="task-empty"
            >
              当前无运行中的任务
            </p>
            <ul v-else class="flex flex-col gap-2">
              <li
                v-for="j in activeJobs"
                :key="j.id"
                class="rounded-md border border-edge bg-raised p-2"
                data-test="task-item"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-xs font-medium text-ink">{{ jobTypeLabel(j.type) }}</span>
                  <Badge :variant="jobStatusInfo(j.status).variant">
                    {{ jobStatusInfo(j.status).label }}
                  </Badge>
                </div>
                <div class="mt-1.5 flex items-center gap-2">
                  <Progress :value="j.progress" data-test="task-progress" class="min-w-0 flex-1" />
                  <span class="shrink-0 text-[10px] text-ink-muted">{{ j.progress }}%</span>
                </div>
              </li>
            </ul>
          </div>
          <footer class="flex items-center justify-between gap-2 border-t border-edge px-3 py-2">
            <span class="text-[10px] text-ink-muted" data-test="task-summary">
              {{ doneCount }} 完成 · {{ failedCount }} 失败
            </span>
            <button
              type="button"
              class="text-xs text-amber-300 transition-colors hover:text-amber-200"
              data-test="task-open-all"
              @click="openTasks"
            >
              任务队列 →
            </button>
          </footer>
        </div>
      </div>
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
