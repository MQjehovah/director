<script setup lang="ts">
import { computed, defineComponent, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import TopBar from './TopBar.vue'
import SideNav from './SideNav.vue'
import StatusBar from './StatusBar.vue'
import { usePluginStore } from '../../stores/pluginStore'
import { useJobStore } from '../../stores/jobStore'

const activeView = ref('characters')
const contextWidth = ref(280)

const jobStore = useJobStore()
const pluginStore = usePluginStore()

const modules = computed(() => pluginStore.featureModules())
const viewComponent = computed(
  () => pluginStore.featureComponent(activeView.value) ?? FallbackPanel,
)
const currentLabel = computed(
  () =>
    modules.value.find((m) => m.key === activeView.value)?.title ?? activeView.value,
)

const FallbackPanel = defineComponent({
  name: 'FallbackPanel',
  render: () => null,
})

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
    <TopBar @settings="activeView = 'settings'" @tasks="activeView = 'tasks'" />

    <div class="flex min-h-0 flex-1">
      <SideNav :modules="modules" :active="activeView" @select="activeView = $event" />

      <main class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div
          class="flex shrink-0 items-center justify-between gap-4 border-b border-edge px-6 py-3"
        >
          <h1 class="text-lg font-semibold">{{ currentLabel }}</h1>
        </div>
        <KeepAlive>
          <component
            :is="viewComponent"
            v-bind="pluginStore.featureViewProps(activeView) ?? {}"
            class="min-h-0 flex-1"
          />
        </KeepAlive>
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
