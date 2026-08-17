<script setup lang="ts">
import { useStoryboardStore } from '../../stores/storyboardStore'
import { useScriptStore } from '../../stores/scriptStore'
import { Button, Progress } from '../../components/ui'
import { usePlayer } from './usePlayer'
import { beatDialogueForShot, shotDuration } from './subtitles'
import ShotPlayer from './ShotPlayer.vue'
import type { Shot } from '../../core/models'

const store = useStoryboardStore()
const scriptStore = useScriptStore()

function getDialogue(shot: Shot): string | undefined {
  return (shot as { dialogue?: string }).dialogue ?? beatDialogueForShot(scriptStore.script, shot)
}

const player = usePlayer(store.shots, { getDialogue })

function widthPct(shot: Shot): number {
  const denom = player.total.value
  return denom > 0 ? Math.max((shotDuration(shot) / denom) * 100, 6) : 0
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 p-4" data-test="player-panel">
    <p v-if="store.shots.length === 0" class="text-sm text-ink-muted" data-test="empty">
      暂无镜头，生成镜头与媒体素材后可在此预览成片。
    </p>

    <template v-else>
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-ink">成片预览</h2>
        <div class="flex items-center gap-3">
          <span class="text-xs text-ink-muted" data-test="player-position">
            {{ player.currentIndex.value + 1 }} / {{ store.shots.length }}
          </span>
          <span class="text-xs text-ink-muted">总时长 {{ player.total.value }}s</span>
        </div>
      </div>

      <div class="overflow-hidden rounded-lg border border-edge bg-zinc-950" data-test="player-shot">
        <ShotPlayer
          v-if="player.currentShot.value"
          :shot="player.currentShot.value"
          :subtitle="player.currentSubtitle.value?.text"
          :playing="player.playing.value"
        />
      </div>

      <div class="flex items-center justify-center gap-2">
        <Button
          size="sm"
          data-test="player-prev"
          :disabled="player.currentIndex.value === 0"
          @click="player.prev()"
        >
          上一条
        </Button>
        <Button
          v-if="!player.playing.value"
          variant="primary"
          size="sm"
          data-test="player-play"
          @click="player.play()"
        >
          播放
        </Button>
        <Button
          v-else
          variant="primary"
          size="sm"
          data-test="player-pause"
          @click="player.pause()"
        >
          暂停
        </Button>
        <Button
          size="sm"
          data-test="player-next"
          :disabled="player.currentIndex.value >= store.shots.length - 1"
          @click="player.next()"
        >
          下一条
        </Button>
        <Button size="sm" data-test="player-reset" @click="player.reset()">重置</Button>
      </div>

      <Progress :value="player.progress.value * 100" data-test="player-progress" />

      <p
        v-if="player.currentSubtitle.value?.text"
        class="text-center text-sm text-ink"
        data-test="player-subtitle"
      >
        {{ player.currentSubtitle.value.text }}
      </p>

      <div class="flex w-full items-stretch gap-1 overflow-x-auto" data-test="player-timeline">
        <button
          v-for="(shot, index) in store.shots"
          :key="shot.id"
          type="button"
          data-test="player-timeline-shot"
          class="flex min-w-0 items-center justify-center overflow-hidden rounded-md border border-edge bg-raised py-1 text-xs transition-colors hover:border-zinc-600"
          :class="
            index === player.currentIndex.value
              ? 'border-amber-400/60 text-ink'
              : 'text-ink-muted'
          "
          :style="{ flex: `1 1 ${widthPct(shot)}%`, minWidth: '48px' }"
          @click="player.seek(index)"
        >
          {{ index + 1 }}
        </button>
      </div>
    </template>
  </div>
</template>
