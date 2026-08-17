import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  buildSubtitleTrack,
  subtitleForTime,
  totalDuration,
  beatDialogueForShot,
} from '../subtitles'
import { usePlayer } from '../usePlayer'
import ShotPlayer from '../ShotPlayer.vue'
import PlayerPanel from '../PlayerPanel.vue'
import { useStoryboardStore } from '../../../stores/storyboardStore'
import { useScriptStore } from '../../../stores/scriptStore'
import { ScriptSchema } from '../../../core/models'
import type { Shot } from '../../../core/models'

function makeCamera(duration: number, move: 'static' | 'zoom-in' = 'static') {
  return { shotSize: 'wide' as const, angle: 'eye-level' as const, move, duration }
}

describe('player subtitles', () => {
  it('maps shots to subtitle timeline', () => {
    const shots = [
      { id: 's1', duration: 3, dialogue: '你好' },
      { id: 's2', duration: 2, dialogue: '再见' },
    ] as any
    const track = buildSubtitleTrack(shots)
    expect(track[0]).toMatchObject({ text: '你好', start: 0, end: 3 })
    expect(track[1]).toMatchObject({ text: '再见', start: 3, end: 5 })
    expect(subtitleForTime(track, 3.5)?.text).toBe('再见')
  })

  it('computes the total duration', () => {
    const track = buildSubtitleTrack([
      { id: 's1', duration: 3, dialogue: 'a' },
      { id: 's2', duration: 2, dialogue: 'b' },
    ] as any)
    expect(totalDuration(track)).toBe(5)
  })

  it('falls back to camera duration', () => {
    const shots = [{ id: 's1', shotType: 'image', camera: makeCamera(6) }] as Shot[]
    const track = buildSubtitleTrack(shots)
    expect(track[0]).toMatchObject({ start: 0, end: 6, duration: 6 })
  })

  it('resolves dialogue text from the script beat', () => {
    const script = ScriptSchema.parse({
      id: 'sc',
      title: '第一集',
      scenes: [
        {
          id: 'sc1',
          beats: [{ id: 'b1', type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } }],
        },
      ],
    })
    const shots = [{ id: 's1', beatRef: 'b1', shotType: 'image', camera: makeCamera(3) }] as Shot[]
    const track = buildSubtitleTrack(shots, (shot) => beatDialogueForShot(script, shot))
    expect(track[0].text).toBe('小明：你好')
  })
})

describe('usePlayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances currentTime while playing', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(10) })
    const player = usePlayer(store.shots)
    player.play()
    vi.advanceTimersByTime(1000)
    expect(player.currentTime.value).toBeCloseTo(1)
    expect(player.progress.value).toBeCloseTo(0.1)
  })

  it('moves to the next shot after the duration elapses', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(1) })
    store.addShot({ shotType: 'image', camera: makeCamera(1) })
    const player = usePlayer(store.shots)
    player.play()
    vi.advanceTimersByTime(1150)
    expect(player.currentIndex.value).toBe(1)
    expect(player.currentTime.value).toBeCloseTo(0.1)
  })

  it('stops at the end of the last shot', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(1) })
    const player = usePlayer(store.shots)
    player.play()
    vi.advanceTimersByTime(1200)
    expect(player.playing.value).toBe(false)
    expect(player.currentTime.value).toBeCloseTo(1)
  })

  it('pause stops advancing time', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(10) })
    const player = usePlayer(store.shots)
    player.play()
    vi.advanceTimersByTime(500)
    player.pause()
    const t = player.currentTime.value
    vi.advanceTimersByTime(1000)
    expect(player.currentTime.value).toBe(t)
  })

  it('seek jumps to a shot and resets the current time', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(3) })
    store.addShot({ shotType: 'image', camera: makeCamera(3) })
    const player = usePlayer(store.shots)
    player.play()
    vi.advanceTimersByTime(500)
    player.seek(1)
    expect(player.currentIndex.value).toBe(1)
    expect(player.currentTime.value).toBe(0)
  })
})

describe('shot player', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the image with a Ken Burns transform and subtitle overlay', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({
      shotType: 'image',
      camera: { shotSize: 'wide', angle: 'eye-level', move: 'zoom-in', duration: 4 },
      mediaAssets: ['data:image/svg+xml;utf8,FAKE'],
    })
    const w = mount(ShotPlayer, { props: { shot, subtitle: '你好', playing: true } })
    await flushPromises()
    expect(w.get('[data-test="shot-image"]').attributes('style')).toContain('scale(1.35)')
    expect(w.get('[data-test="subtitle"]').text()).toBe('你好')
  })

  it('renders a video element for a video shot with a real video url', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video', mediaAssets: ['https://example.com/clip.mp4'] })
    const w = mount(ShotPlayer, { props: { shot, playing: true } })
    await flushPromises()
    expect(w.find('[data-test="shot-video"]').exists()).toBe(true)
  })

  it('shows the image placeholder when a video asset resolves to a data:image url', async () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'video', mediaAssets: ['data:image/svg+xml;utf8,FAKE'] })
    const w = mount(ShotPlayer, { props: { shot, playing: true } })
    await flushPromises()
    expect(w.find('[data-test="shot-image"]').exists()).toBe(true)
  })

  it('shows a placeholder when the shot has no media asset', () => {
    const store = useStoryboardStore()
    const shot = store.addShot({ shotType: 'image' })
    const w = mount(ShotPlayer, { props: { shot } })
    expect(w.get('[data-test="shot-placeholder"]').text()).toContain('待生成')
  })
})

describe('player panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows an empty state when there are no shots', () => {
    const w = mount(PlayerPanel)
    expect(w.get('[data-test="empty"]')).toBeTruthy()
  })

  it('renders controls, preview and timeline when shots exist', () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(3) })
    store.addShot({ shotType: 'video', camera: makeCamera(4) })
    const w = mount(PlayerPanel)
    expect(w.get('[data-test="player-play"]')).toBeTruthy()
    expect(w.get('[data-test="player-prev"]')).toBeTruthy()
    expect(w.get('[data-test="player-next"]')).toBeTruthy()
    expect(w.get('[data-test="player-reset"]')).toBeTruthy()
    expect(w.get('[data-test="player-shot"]')).toBeTruthy()
    expect(w.findAll('[data-test="player-timeline-shot"]')).toHaveLength(2)
  })

  it('toggles play and pause', async () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', camera: makeCamera(3) })
    const w = mount(PlayerPanel)
    await w.get('[data-test="player-play"]').trigger('click')
    expect(w.get('[data-test="player-pause"]')).toBeTruthy()
    await w.get('[data-test="player-pause"]').trigger('click')
    expect(w.get('[data-test="player-play"]')).toBeTruthy()
    w.unmount()
  })

  it('seeks to a shot when clicking the timeline', async () => {
    const store = useStoryboardStore()
    store.addShot({ shotType: 'image', prompt: '第一个' })
    store.addShot({ shotType: 'image', prompt: '第二个' })
    const w = mount(PlayerPanel)
    expect(w.get('[data-test="player-position"]').text()).toBe('1 / 2')
    await w.findAll('[data-test="player-timeline-shot"]')[1].trigger('click')
    expect(w.get('[data-test="player-position"]').text()).toBe('2 / 2')
  })

  it('shows dialogue subtitles resolved from the script beat', () => {
    const store = useStoryboardStore()
    const scriptStore = useScriptStore()
    const scene = scriptStore.addScene({ title: '第一场' })
    const beat = scriptStore.addBeat(scene.id, {
      type: 'dialogue',
      dialogue: { speaker: '小明', text: '你好' },
    })
    store.addShot({ shotType: 'image', beatRef: beat.id, camera: makeCamera(3) })
    const w = mount(PlayerPanel)
    expect(w.get('[data-test="player-subtitle"]').text()).toBe('小明：你好')
  })
})
