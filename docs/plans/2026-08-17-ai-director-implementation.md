# AI导演台 — 前端实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个插件化架构的 AI导演台前端（Vue 3 + Vite + TS），包含角色编辑、剧本编辑、镜头编排、成片预览、任务队列与一键全流程。

**Architecture:** 稳定内核（core）定义领域模型与插件系统；Provider 能力接口（Media/LLM/TTS/Storage）由 mock 与真实实现插件分别实现，可切换；功能模块作为 FeaturePlugin 装配到界面；本地 IndexedDB 持久化为主。

**Tech Stack:** Vue 3.4+ / Vite / TypeScript / Pinia / shadcn-vue + Tailwind / zod / Vitest / Vue Test Utils / Dexie

参考设计文档：`docs/plans/2026-08-17-ai-director-design.md`

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.gitignore`, `src/main.ts`, `src/App.vue`, `src/vite-env.d.ts`
- Test: 运行构建

**Step 1: 创建项目文件**

`package.json`:
```json
{
  "name": "ai-director",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "vue-tsc -b --noEmit"
  },
  "dependencies": {
    "vue": "^3.4.0",
    "pinia": "^2.1.7",
    "zod": "^3.22.4",
    "dexie": "^4.0.4",
    "@vueuse/core": "^10.7.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vue-tsc": "^2.0.0",
    "vitest": "^1.5.0",
    "@vue/test-utils": "^2.4.5",
    "jsdom": "^24.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "unplugin-auto-import": "^0.17.0",
    "unplugin-vue-components": "^0.26.0"
  }
}
```

**Step 2: 安装依赖**

Run: `npm install`
Expected: 安装成功，无报错

**Step 3: 创建基础配置与入口**

创建 `vite.config.ts`（含 vitest 配置 jsdom 环境）、`tsconfig.json`、`tsconfig.node.json`、`index.html`、`.gitignore`（node_modules/dist）、`src/main.ts`（挂载 App + Pinia）、`src/App.vue`（空壳路由占位）、`src/vite-env.d.ts`。

**Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功，输出 dist/

**Step 5: 提交**

```bash
git add -A
git commit -m "chore: scaffold vue3+vite+ts project"
```

---

### Task 2: 领域模型 core/models

**Files:**
- Create: `src/core/models/types.ts`, `src/core/models/character.ts`, `src/core/models/script.ts`, `src/core/models/shot.ts`, `src/core/models/asset.ts`, `src/core/models/job.ts`, `src/core/models/project.ts`, `src/core/models/index.ts`
- Test: `src/core/models/__tests__/models.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { CharacterSchema, ShotSchema, JobSchema } from '../index'

describe('domain models', () => {
  it('validates a character', () => {
    const c = CharacterSchema.parse({ id: 'c1', name: '小明', appearance: '黑发少年' })
    expect(c.name).toBe('小明')
    expect(c.referenceImages).toEqual([])
  })
  it('rejects invalid shotType', () => {
    expect(() => ShotSchema.parse({ id: 's1', beatRef: 'b1', shotType: 'gif' })).toThrow()
  })
  it('enforces job status enum', () => {
    const j = JobSchema.parse({ id: 'j1', type: 'text2image', status: 'queued' })
    expect(j.status).toBe('queued')
    expect(() => JobSchema.parse({ id: 'j2', type: 'x', status: 'bogus' })).toThrow()
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/core/models/__tests__/models.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现模型**

用 zod 定义全部模型（见设计文档 §4）。`Shot` 含 `camera`（shotSize/angle/move/duration），`Asset` 含 `kind/source`，`Job` 含 `status/progress/pluginId`。`Project` 引用 characterIds/scriptId/storyboardRefs。

**Step 4: 运行测试通过**

Run: `npx vitest run src/core/models/__tests__/models.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: domain models with zod schemas"
```

---

### Task 3: 插件系统 core/plugin

**Files:**
- Create: `src/core/plugin/types.ts`, `src/core/plugin/registry.ts`, `src/core/plugin/manager.ts`, `src/core/bus.ts`, `src/core/index.ts`
- Test: `src/core/plugin/__tests__/registry.test.ts`, `src/core/plugin/__tests__/manager.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { PluginRegistry } from '../registry'
import type { Plugin, ProviderPlugin, FeaturePlugin } from '../types'

describe('plugin registry', () => {
  it('registers and resolves providers by interface', () => {
    const r = new PluginRegistry()
    const p: ProviderPlugin = { id: 'mock', name: 'Mock', kind: 'provider', providerType: 'media', enabled: true, capabilities: { text2image: true, image2video: false, text2video: false, upscale: false } }
    r.register(p)
    expect(r.resolveProvider('media')).toHaveLength(1)
    expect(r.isEnabled('mock')).toBe(true)
  })
  it('dispatches lifecycle events', () => {
    const r = new PluginRegistry()
    const spy = vi.fn()
    r.on('plugin:registered', spy)
    r.register({ id: 'f1', name: 'F', kind: 'feature', featureId: 'characters', enabled: true } as FeaturePlugin)
    expect(spy).toHaveBeenCalled()
  })
})

describe('plugin manager', () => {
  it('toggles plugins and persists state', () => {
    const m = new PluginManager(new PluginRegistry())
    m.toggle('mock', false)
    expect(m.isEnabled('mock')).toBe(false)
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/core/plugin/__tests__`
Expected: FAIL

**Step 3: 实现**

- `types.ts`：`Plugin` 基类（id/name/kind/enabled）、`ProviderPlugin`（providerType + capabilities）、`FeaturePlugin`（featureId）、`PipelinePlugin`、生命周期事件类型。
- `registry.ts`：`PluginRegistry`，`register/resolveProvider(type)/isEnabled/enable/disable`，基于 `bus` 发事件。
- `manager.ts`：`PluginManager` 封装注册表操作与启用状态管理。
- `bus.ts`：极简事件总线（on/off/emit，typed）。

**Step 4: 运行测试通过**

Run: `npx vitest run src/core/plugin/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: plugin system core (registry, manager, bus)"
```

---

### Task 4: Provider 接口与 mock 插件

**Files:**
- Create: `src/providers/MediaProvider.ts`, `src/providers/LLMProvider.ts`, `src/providers/TTSProvider.ts`, `src/providers/StorageProvider.ts`, `src/providers/index.ts`
- Create: `src/plugins/providers/media-mock.ts`, `src/plugins/providers/llm-mock.ts`, `src/plugins/providers/tts-mock.ts`, `src/plugins/providers/storage-indexeddb.ts`, `src/plugins/providers/index.ts`
- Test: `src/plugins/providers/__tests__/mock-providers.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { createMediaMockProvider } from '../media-mock'
import { createLLMMockProvider } from '../llm-mock'

describe('mock providers', () => {
  it('media mock returns a job that completes', async () => {
    const p = createMediaMockProvider()
    const job = await p.generateImage({ prompt: 'x', width: 512, height: 512, seed: 1 })
    expect(job.type).toBe('text2image')
    expect(job.status).toBe('running')
    const done = await p.waitForJob(job.id)
    expect(done.status).toBe('done')
    expect(done.result?.assetIds).toHaveLength(1)
  })
  it('llm mock streams a reply', async () => {
    const p = createLLMMockProvider()
    let text = ''
    for await (const chunk of p.chat([{ role: 'user', content: 'hi' }])) text += chunk
    expect(text.length).toBeGreaterThan(0)
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/plugins/providers/__tests__`
Expected: FAIL

**Step 3: 实现**

- 各 Provider 接口定义（见设计文档 §5 类型签名）。
- mock 实现：`MediaMockProvider.generateImage` 创建 running Job，延时 setTimeout 1s 后标记 done 并生成占位 Asset（canvas 生成带文本的占位图或 svg data url）；`LLMMockProvider.chat` 异步生成器流式返回；`TTSSyncMock` 返回合成 Job。
- `storage-indexeddb.ts`：Dexie 封装 `projects`/`assets` 表，实现 loadProject/saveProject/listProjects/deleteProject/saveAsset/getAssetUrl。
- `waitForJob` 为 mock 测试辅助方法（真实 HTTP provider 用轮询）。

**Step 4: 运行测试通过**

Run: `npx vitest run src/plugins/providers/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: provider interfaces with mock implementations"
```

---

### Task 5: 状态层 stores

**Files:**
- Create: `src/stores/projectStore.ts`, `src/stores/characterStore.ts`, `src/stores/scriptStore.ts`, `src/stores/storyboardStore.ts`, `src/stores/jobStore.ts`, `src/stores/pluginStore.ts`
- Test: `src/stores/__tests__/jobStore.test.ts`, `src/stores/__tests__/characterStore.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useJobStore } from '../jobStore'

describe('job store', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('adds job, updates progress, marks done', () => {
    const s = useJobStore()
    s.addJob({ id: 'j1', type: 'text2image', status: 'running', progress: 0 })
    s.updateProgress('j1', 50)
    expect(s.jobs[0].progress).toBe(50)
    s.markDone('j1', { assetIds: ['a1'] })
    expect(s.jobs[0].status).toBe('done')
  })
  it('tracks jobs by shot', () => {
    const s = useJobStore()
    s.addJob({ id: 'j2', type: 'image2video', status: 'queued', progress: 0, shotRef: 's1' })
    expect(s.jobsForShot('s1')).toHaveLength(1)
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/stores/__tests__`
Expected: FAIL

**Step 3: 实现**

- `projectStore`：当前项目、load/save 桥接 StorageProvider。
- `characterStore`：CRUD + 角色卡。
- `scriptStore`：场次/节拍 CRUD + markdown 导入解析。
- `storyboardStore`：镜头 CRUD、重排、cutSceneToShots（一键切镜）。
- `jobStore`：任务集合、progress、done/failed/canceled、jobsForShot。
- `pluginStore`：Provider 选择与配置、启用状态。
- 均采用 Pinia setup store，action 内调用 Provider。

**Step 4: 运行测试通过**

Run: `npx vitest run src/stores/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: pinia stores for domain state"
```

---

### Task 6: UI 基础（Tailwind + shadcn/vue + 布局）

**Files:**
- Create: `tailwind.config.js`, `postcss.config.js`, `src/assets/main.css`, `src/components/ui/index.ts`
- Create: `src/components/layout/AppShell.vue`, `src/components/layout/SideNav.vue`, `src/components/layout/TopBar.vue`, `src/components/layout/StatusBar.vue`
- Modify: `src/App.vue`, `src/main.ts`
- Test: `src/components/layout/__tests__/app-shell.test.ts`

**Step 1: 写失败测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import AppShell from '../AppShell.vue'

describe('app shell', () => {
  it('renders nav sections', () => {
    const w = mount(AppShell)
    expect(w.text()).toContain('角色')
    expect(w.text()).toContain('剧本')
    expect(w.text()).toContain('分镜')
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/components/layout/__tests__`
Expected: FAIL（模块不存在）

**Step 3: 实现**

- 配置 Tailwind/PostCSS，创建 `main.css` 引入 tailwind 指令与 design tokens。
- 按设计文档 §7 布局搭建 AppShell（顶栏/左导航/主区/右面板/底栏）。
- 用 `@vueuse/core` 拖拽辅助 + 简单手写 UI 组件（button/input/dialog 等基础件），shadcn/vue 按需后续接入。

**Step 4: 运行测试通过 + 手动验证**

Run: `npx vitest run src/components/layout/__tests__`
Expected: PASS
Run: `npm run dev`，浏览器确认布局渲染。

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: app shell layout with tailwind"
```

---

### Task 7: 角色编辑器 features/characters

**Files:**
- Create: `src/features/characters/CharacterPanel.vue`, `src/features/characters/CharacterGrid.vue`, `src/features/characters/CharacterEditor.vue`, `src/features/characters/useCharacterFeatures.ts`
- Test: `src/features/characters/__tests__/characterEditor.test.ts`

**Step 1: 写失败测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import CharacterGrid from '../CharacterGrid.vue'
import { useCharacterStore } from '../../../stores/characterStore'

describe('character grid', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('renders characters and adds new one', async () => {
    const store = useCharacterStore()
    store.addCharacter({ id: 'c1', name: '小明' })
    const w = mount(CharacterGrid)
    expect(w.text()).toContain('小明')
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/characters/__tests__`
Expected: FAIL

**Step 3: 实现**

- 网格卡片 + 详情抽屉编辑器（外貌/参考图/音色/LoRA/标签）。
- `useCharacterFeatures`：封装「AI 生成角色设定」「AI 扩写参考图描述」action（调用 LLMProvider）。
- 「生成立绘」按钮 → jobStore 建任务 → media provider。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/characters/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: character editor feature"
```

---

### Task 8: 剧本编辑器 features/script

**Files:**
- Create: `src/features/script/ScriptPanel.vue`, `src/features/script/SceneEditor.vue`, `src/features/script/BeatList.vue`, `src/features/script/useScriptFeatures.ts`
- Test: `src/features/script/__tests__/sceneEditor.test.ts`

**Step 1: 写失败测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import BeatList from '../BeatList.vue'
import { useScriptStore } from '../../../stores/scriptStore'

describe('beat list', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('renders dialogue beats and edits text', async () => {
    const store = useScriptStore()
    store.addScene({ id: 'sc1', title: '开场' })
    store.addBeat('sc1', { id: 'b1', type: 'dialogue', dialogue: { speaker: '小明', text: '你好' } })
    const w = mount(BeatList, { props: { sceneId: 'sc1' } })
    expect(w.text()).toContain('你好')
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/script/__tests__`
Expected: FAIL

**Step 3: 实现**

- 场景编辑器：场次列表 + 节拍序列编辑（对话/动作/音效）。
- `useScriptFeatures`：AI 生成剧本、AI 改写节拍（LLMProvider）、Markdown 导入、一键切镜（调用 storyboardStore.cutSceneToShots）。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/script/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: script editor feature"
```

---

### Task 9: 镜头编排 features/storyboard

**Files:**
- Create: `src/features/storyboard/StoryboardPanel.vue`, `src/features/storyboard/ShotGrid.vue`, `src/features/storyboard/ShotEditor.vue`, `src/features/storyboard/ShotTimeline.vue`, `src/features/storyboard/useShotActions.ts`
- Test: `src/features/storyboard/__tests__/shotEditor.test.ts`

**Step 1: 写失败测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import ShotGrid from '../ShotGrid.vue'
import { useStoryboardStore } from '../../../stores/storyboardStore'

describe('shot grid', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('shows shots with placeholder when no asset', () => {
    const store = useStoryboardStore()
    store.addShot({ id: 's1', beatRef: 'b1', shotType: 'image' })
    const w = mount(ShotGrid)
    expect(w.text()).toContain('待生成')
  })
  it('render action creates job', async () => {
    const store = useStoryboardStore()
    const w = mount(ShotGrid)
    await w.find('.render-btn').trigger('click')
    // 触发 useShotActions.generateMedia -> jobStore
    const jobs = useJobStore()
    expect(jobs.jobs.length).toBe(1)
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/storyboard/__tests__`
Expected: FAIL

**Step 3: 实现**

- 镜头网格 + 拖拽重排（@vueuse/drag 或原生 DnD）。
- 镜头编辑面板：shotType/camera（景别/机位/运镜/时长）/prompt/seed/时长。
- `useShotActions`：generateMedia → jobStore + media provider → 完成回填 asset；job 状态驱动缩略图占位→加载→成品。
- 时间轴视图：镜头序列条，成片顺序。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/storyboard/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: storyboard editor feature"
```

---

### Task 10: 成片预览 features/player

**Files:**
- Create: `src/features/player/PlayerPanel.vue`, `src/features/player/ShotPlayer.vue`, `src/features/player/subtitles.ts`, `src/features/player/usePlayer.ts`
- Test: `src/features/player/__tests__/player.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { buildSubtitleTrack, subtitleForTime } from '../subtitles'

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
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/player/__tests__`
Expected: FAIL

**Step 3: 实现**

- 时间轴播放器：顺序播放镜头，图片镜头加 Ken Burns（CSS transform 过渡）+ 字幕叠加，视频镜头直接播放。
- 字幕轨道由镜头时长推导（纯函数，便于测试）。
- 音频轨：TTS 配音资产按时间叠加（HTMLAudioElement 控制）。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/player/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: player with subtitle timeline"
```

---

### Task 11: 任务队列面板 features/jobs

**Files:**
- Create: `src/features/jobs/JobDrawer.vue`, `src/features/jobs/JobItem.vue`
- Test: `src/features/jobs/__tests__/jobItem.test.ts`

**Step 1: 写失败测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import JobItem from '../JobItem.vue'
import { useJobStore } from '../../../stores/jobStore'

describe('job item', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('renders progress and status', () => {
    const store = useJobStore()
    store.addJob({ id: 'j1', type: 'text2image', status: 'running', progress: 40 })
    const w = mount(JobItem, { props: { jobId: 'j1' } })
    expect(w.text()).toContain('40%')
    expect(w.text()).toContain('生成中')
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/jobs/__tests__`
Expected: FAIL

**Step 3: 实现**

- 抽屉面板：任务列表（状态徽章、进度条、所属镜头、插件名）。
- 操作：取消、重试、定位镜头。
- 底栏集成全局进度汇总。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/jobs/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: job queue drawer"
```

---

### Task 12: 一键全流程 features/composer

**Files:**
- Create: `src/features/composer/ComposerPanel.vue`, `src/features/composer/PipelineEditor.vue`, `src/features/composer/PipelineRunner.ts`
- Test: `src/features/composer/__tests__/pipeline.test.ts`

**Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { PipelineRunner } from '../PipelineRunner'
import { createMediaMockProvider } from '../../../plugins/providers/media-mock'

describe('pipeline runner', () => {
  it('executes steps in order and skips disabled', async () => {
    const order: string[] = []
    const steps = [
      { id: 'a', enabled: true, run: async () => { order.push('a') } },
      { id: 'b', enabled: false, run: async () => { order.push('b') } },
      { id: 'c', enabled: true, run: async () => { order.push('c') } },
    ]
    const r = new PipelineRunner()
    await r.run(steps)
    expect(order).toEqual(['a', 'c'])
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/composer/__tests__`
Expected: FAIL

**Step 3: 实现**

- 管道编辑器：步骤列表（生成剧本→切分镜头→生成角色→出图→配音→组装），每步可启用/跳过/绑定 Provider，拖拽排序。
- `PipelineRunner`：顺序执行、跳过禁用、步骤结果传递、中途错误记录。
- 预设步骤为简单函数（基于 stores + providers），后续可扩展 PipelinePlugin。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/composer/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: one-click pipeline composer"
```

---

### Task 13: 设置页与 Provider 配置

**Files:**
- Create: `src/features/settings/SettingsPanel.vue`, `src/features/settings/ProviderConfig.vue`, `src/features/settings/httpBackendConfig.ts`
- Test: `src/features/settings/__tests__/providerConfig.test.ts`

**Step 1: 写失败测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import ProviderConfig from '../ProviderConfig.vue'
import { usePluginStore } from '../../../stores/pluginStore'

describe('provider config', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('toggles provider and persists', async () => {
    const store = usePluginStore()
    const w = mount(ProviderConfig)
    await w.find('input[type=checkbox]').setValue(false)
    expect(store.isEnabled('mock')).toBe(false)
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/features/settings/__tests__`
Expected: FAIL

**Step 3: 实现**

- 设置面板：Provider 列表、启停开关、地址/密钥/参数表单（存 localStorage，key 前缀 `ai-director:provider:`）。
- 配置变更后 pluginStore 重载 provider 实例。
- 预留 http-backend / comfyui 配置表单字段（地址、token、模型名）。

**Step 4: 运行测试通过**

Run: `npx vitest run src/features/settings/__tests__`
Expected: PASS

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: settings panel with provider config"
```

---

### Task 14: 集成接线与收尾

**Files:**
- Modify: `src/App.vue`（路由/视图切换）、`src/main.ts`（注册插件、初始化 store）、`src/stores/pluginStore.ts`（默认注册 mock 插件）
- Create: `src/plugins/register.ts`（应用启动时注册全部内置插件）

**Step 1: 集成测试（跨模块冒烟）**

```ts
// src/integration.test.ts
import { describe, it, expect } from 'vitest'
import { buildAppPlugins } from './plugins/register'
import { PluginRegistry } from './core/plugin/registry'

describe('plugin integration', () => {
  it('registers all built-in plugins', () => {
    const r = buildAppPlugins()
    expect(r.resolveProvider('media').length).toBeGreaterThan(0)
    expect(r.resolveProvider('llm').length).toBeGreaterThan(0)
    expect(r.resolveProvider('storage').length).toBeGreaterThan(0)
  })
})
```

**Step 2: 运行确认失败**

Run: `npx vitest run src/integration.test.ts`
Expected: FAIL

**Step 3: 实现接线**

- `plugins/register.ts` 返回组装好的 PluginRegistry，注册全部内置插件。
- App.vue：左侧导航切换模块视图（角色/剧本/分镜/成片/任务/全流程/设置）。
- main.ts：创建 pinia、注册插件、挂载。

**Step 4: 全量验证**

Run: `npm test`
Expected: 全部测试通过
Run: `npm run build`
Expected: 构建成功
Run: `npm run dev` 手动走通全流程（mock 模式：新建项目→AI 生成剧本→切镜→出图→预览）。

**Step 5: 提交**

```bash
git add -A
git commit -m "feat: wire up app modules end-to-end"
```

---

### Task 15: README 与收尾文档

**Files:**
- Create: `README.md`（项目说明、启动方式、插件机制简述、mock/真实后端切换说明）

**Step 1: 编写 README**

内容：功能简介、技术栈、`npm install` / `npm run dev` / `npm test` / `npm run build`、插件架构概览、如何添加自定义 Provider 插件示例、后端对接指南（REST / OpenAI 兼容 / ComfyUI 地址配置）。

**Step 2: 验证命令**

Run: `npm test && npm run build`
Expected: 全部通过

**Step 3: 提交**

```bash
git add -A
git commit -m "docs: readme and usage guide"
```

---

## 验证清单

- [ ] `npm test` 全绿
- [ ] `npm run build` 成功
- [ ] `npm run dev` 下 mock 模式完整走通：项目→剧本→切镜→出图→成片预览
- [ ] 设置页可切换 Provider 并持久化
- [ ] git 历史含分步提交记录
