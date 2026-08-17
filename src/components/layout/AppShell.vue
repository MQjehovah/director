<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import TopBar from './TopBar.vue'
import SideNav from './SideNav.vue'
import StatusBar from './StatusBar.vue'

const MODULE_LABELS: Record<string, string> = {
  characters: '角色管理',
  script: '剧本编辑器',
  storyboard: '分镜设计',
  film: '成片合成',
  tasks: '任务中心',
  pipeline: '全流程',
}

const activeView = ref('characters')
const contextWidth = ref(280)

const currentLabel = computed(() => MODULE_LABELS[activeView.value] ?? activeView.value)

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
          <span class="text-xs text-ink-muted">模块占位 · 后续任务接入</span>
        </div>
        <div class="flex flex-1 items-center justify-center p-6">
          <p class="max-w-sm text-center text-sm text-ink-muted">
            「{{ currentLabel }}」模块尚未实现，将在后续任务中接入。
          </p>
        </div>
      </main>

      <button
        type="button"
        class="w-1.5 shrink-0 cursor-col-resize border-l border-edge bg-zinc-800 transition-colors hover:bg-amber-400/50"
        aria-label="调整上下文面板宽度"
        @pointerdown="startResize"
      />
      <aside
        class="w-72 shrink-0 overflow-y-auto border-l border-edge bg-panel p-4"
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

    <StatusBar :running="0" :done="0" :failed="0" />
  </div>
</template>
