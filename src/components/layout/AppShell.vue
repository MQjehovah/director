<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { useEventListener } from '@vueuse/core'
import TopBar from './TopBar.vue'
import SideNav from './SideNav.vue'
import StatusBar from './StatusBar.vue'
import { moduleTitle } from './modules'
import CharacterPanel from '../../features/characters/CharacterPanel.vue'
import ScriptPanel from '../../features/script/ScriptPanel.vue'
import StoryboardPanel from '../../features/storyboard/StoryboardPanel.vue'
import PlayerPanel from '../../features/player/PlayerPanel.vue'
import JobDrawer from '../../features/jobs/JobDrawer.vue'
import ComposerPanel from '../../features/composer/ComposerPanel.vue'
import SettingsPanel from '../../features/settings/SettingsPanel.vue'
import { useJobStore } from '../../stores/jobStore'

const activeView = ref('characters')
const contextWidth = ref(280)

const jobStore = useJobStore()

const viewMap: Record<string, Component> = {
  characters: CharacterPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  film: PlayerPanel,
  tasks: JobDrawer,
  pipeline: ComposerPanel,
  settings: SettingsPanel,
}

const viewProps: Record<string, Record<string, unknown>> = {
  tasks: { open: true, inline: true },
}

const viewComponent = computed(() => viewMap[activeView.value] ?? CharacterPanel)
const currentLabel = computed(() => moduleTitle(activeView.value))

const runningCount = computed(
  () => jobStore.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
)
const doneCount = computed(() => jobStore.jobs.filter((j) => j.status === 'done').length)
const failedCount = computed(() => jobStore.jobs.filter((j) => j.status === 'failed').length)

function startResize(e: PointerEvent) {
  const startX = e.clientX
  const startWidth = contextWidth.value
  const target = e.target as HTMLElement
  target.setPointerCapture(e.pointerId)
  const stopMove = useEventListener(window, 'pointermove', (ev) => {
    contextWidth.value = Math.min(Math.max(startWidth + startX - ev.clientX, 240), 520)
  })
  const stopUp = useEventListener(window, 'pointerup', () => {
    stopMove()
    stopUp()
  })
}
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-panel text-ink">
    <TopBar project-name="AI 漫剧导演台" />

    <div class="flex min-h-0 flex-1">
      <SideNav :active="activeView" @select="activeView = $event" />

      <main class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div
          class="flex shrink-0 items-center justify-between gap-4 border-b border-edge px-6 py-3"
        >
          <h1 class="text-lg font-semibold">{{ currentLabel }}</h1>
        </div>
        <component
          :is="viewComponent"
          v-bind="viewProps[activeView] ?? {}"
          class="min-h-0 flex-1"
        />
      </main>

      <button
        type="button"
        class="w-1.5 shrink-0 cursor-col-resize border-l border-edge bg-zinc-800 transition-colors hover:bg-amber-400/50"
        aria-label="调整上下文面板宽度"
        @pointerdown="startResize"
      />
      <aside
        class="shrink-0 overflow-y-auto border-l border-edge bg-panel p-4"
        :style="{ width: `${contextWidth}px` }"
      >
        <h2
          class="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          上下文
        </h2>
        <p class="text-xs leading-relaxed text-ink-muted">
          选中对象的属性将在此显示。
        </p>
      </aside>
    </div>

    <StatusBar :running="runningCount" :done="doneCount" :failed="failedCount" />
  </div>
</template>
