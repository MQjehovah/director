# 插件体系重构 — 设计文档

日期：2026-08-17
状态：待评审
前置：`2026-08-17-ai-director-design.md`（原架构）、`2026-08-17-ai-director-implementation.md`（原实施）

## 1. 背景与问题

当前插件化只落地了一半：

| 插件类型 | 类型定义 | 实际使用 | 问题 |
|---------|---------|---------|------|
| `ProviderPlugin` | ✅ | ✅ 注册/启停/配置/选为当前 | 媒体能力被平铺在一个 `MediaProvider` 接口，加能力（改图/超分）需改接口 + 全部实现 |
| `FeaturePlugin` | ✅ | ❌ 从未使用 | 模块由 `modules.ts` + `AppShell.viewMap` 硬编码，加模块需改两个文件，无法插件化扩展 |
| `PipelinePlugin` | ✅ | ❌ 从未使用 | 管道步骤是工厂函数数组，未走注册表，用户无法注册自定义步骤 |

另外 ComfyUI 接入体验差：需手改工作流 JSON、手动替换占位符、轮询进度。

## 2. 设计原则

- **Provider = 后端连接，能力 = 后端能做的事**。Provider 数量 = 后端数量；能力清单 = 每个后端实现的能力集合。重构不增加 Provider 数量。
- **模块/步骤插件化**：新增模块 = 写一个 FeaturePlugin + 注册一行，不碰 AppShell。
- **渐进兼容**：重构期间保持现有 UI 与测试可运行，每步独立可提交。

## 3. 能力接口重构（media capability interfaces）

### 3.1 能力接口（providers/capabilities/）

```ts
// providers/capabilities/text-to-image.ts
export interface TextToImageParams { prompt: string; negativePrompt?: string; width?: number; height?: number; seed?: number; shotRef?: string }
export interface TextToImageCapability {
  generateImage(params: TextToImageParams): Promise<Job>
}

// providers/capabilities/text-to-video.ts
export interface TextToVideoParams { prompt: string; shotRef?: string }
export interface TextToVideoCapability { generateVideo(params: TextToVideoParams): Promise<Job> }

// providers/capabilities/image-to-video.ts
export interface ImageToVideoParams { imageAssetId?: string; prompt?: string; shotRef?: string }
export interface ImageToVideoCapability { generateVideo(params: ImageToVideoParams): Promise<Job> }

// providers/capabilities/image-edit.ts  (预留，本轮不强制实现)
export interface ImageEditParams { imageAssetId: string; prompt: string; ... }
export interface ImageEditCapability { editImage(params: ImageEditParams): Promise<Job> }

// providers/capabilities/upscale.ts  (预留)
export interface UpscaleCapability { upscale(params: UpscaleParams): Promise<Job> }
```

### 3.2 能力清单（core/plugin/types.ts）

```ts
export type MediaCapability =
  | 'text2image' | 'text2video' | 'image2video' | 'editImage' | 'upscale'

// ProviderPlugin.capabilities 由布尔位图改为能力名集合
export interface ProviderPlugin<T = unknown> extends PluginBase {
  kind: 'provider'
  providerType: ProviderType
  capabilities?: string[]          // e.g. ['text2image', 'image2video']
  configFields?: ProviderConfigField[]
  instance?: T
}
```

- 现有 `capabilities: { text2image: true, ... }` 布尔位图 → 能力名数组 `['text2image','image2video']`。
- 迁移：所有 `ProviderPlugin.capabilities` 消费者改为 `includes(cap)`；mock/comfyui/dashscope 三个实现改为数组。

### 3.3 通用 Job 基础设施（providers/capabilities/shared.ts）

Provider 需要统一的「任务注册 + 轮询 + 监听 + 取消」骨架，避免每个能力实现各自维护 jobs/pollers/listeners：

```ts
// 任务控制器：管理 jobs Map / listeners / getJob / onJobUpdate / waitForJob / cancelJob
export function createJobController(opts?: { pollIntervalMs?: number })
export interface JobController { getJob; onJobUpdate; waitForJob; cancelJob; setJob; startPoller; stopPoller }
```

- 媒体 Provider 组合一个 `JobController`，能力方法调用它注册任务、启动轮询。
- 非媒体 Provider（LLM/TTS/Storage）不变。

### 3.4 媒体 Provider 组合（plugins/providers/ 各实现）

```ts
// media-dashscope.ts 只实现文生图
const ctrl = createJobController()
const instance = {
  id: MEDIA_DASHSCOPE_ID, name: 'DashScope 文生图',
  capabilities: ['text2image'],
  generateImage: (p) => {...ctrl...},   // 仅文生图
  getJob: ctrl.getJob, onJobUpdate: ctrl.onJobUpdate, cancelJob: ctrl.cancelJob,
}
```

- `MediaProvider` 旧接口删除或保留为聚合类型（提供 capability 判断辅助函数 `resolveCapability(provider, cap)`）。
- 调用点迁移：
  - `useShotActions.generateMedia` → 按 shot 需求选择能力 Provider（image→text2image；video→image2video 或 text2video），从 pluginStore 解析。
  - `useCharacterFeatures.generatePortrait` → text2image。
  - `jobStore`/任务队列不感知能力，仍按 job.type 展示。
- `pluginStore` 增加 `resolveProviderCapability(type, cap): ProviderPlugin | undefined` 与 `resolveInstanceCapability(type, cap): instance | undefined`，优先选中的 Provider，否则第一个启用的具备该能力的。

## 4. FeaturePlugin 落地（模块注册化）

### 4.1 FeaturePlugin 类型（core/plugin/types.ts）

```ts
export interface FeatureModuleDef {
  key: string
  label: string
  title: string
  order?: number
}
export interface FeaturePlugin extends PluginBase {
  kind: 'feature'
  featureId: string
  module?: FeatureModuleDef        // 提供导航模块（可选：某些 feature 无独立导航）
  component: Component             // 主区渲染组件
  viewProps?: Record<string, unknown>
}
```

### 4.2 模块注册表动态化

- `src/components/layout/modules.ts` 不再硬编码数组，改为从 registry 收集：
  ```ts
  export function collectModules(registry: PluginRegistry): FeatureModuleDef[]
  export function resolveFeatureComponent(registry, key): Component
  ```
- `register.ts` 注册 7 个 FeaturePlugin（characters/script/storyboard/film/tasks/pipeline/settings），每个 import 对应组件。
- `AppShell.vue`：
  - 启动时（onMounted 或 main 注入）读取 `registry` → `modules`（带 order 排序）
  - `SideNav` 渲染收集到的 modules
  - 主区 `<component :is="resolveFeatureComponent(activeKey)">`
- `main.ts` 在注册 Provider 后调用 `registerFeatures(registry)` 收集模块，或 AppShell 内部 `usePluginStore().init` 后读取。

### 4.3 测试影响

- `app-shell.test.ts` 与 `integration.test.ts` 目前断言 7 个 nav 模块——FeaturePlugin 全部注册后结果不变，测试保持。
- 新增 FeaturePlugin 注册/收集的单元测试。

## 5. ComfyUI 模板管理器 + 实时进度

### 5.1 模板管理器（features/settings 或独立 workflowStore）

- 数据：`WorkflowTemplate { id, name, graphJson, promptNodeId, negativeNodeId, seedNodeId }`
- 导入：粘贴 API 格式工作流 JSON → 自动扫描节点：
  - `CLIPTextEncode` 节点（提示词）；`KSampler` 节点（seed）；`SaveImage` 节点（输出）
  - 无则手动下拉指定
- 持久化：localStorage（key `ai-director:workflow-templates`），存多份命名模板
- `media-comfyui` 配置字段 `workflow` 改为可选模板 id（`workflowTemplateId`）；读取时加载模板并注入 prompt/negative/seed 到对应节点 id，不再要求手动占位符

### 5.2 实时进度（WebSocket）

- ComfyUI 暴露 `/ws?clientId=<uuid>`，发送 `{"type":"progress","data":{value, max}}` 等事件
- `media-comfyui` 增加：生成时建 ws 连接，更新 job.progress；断开时回退到轮询 `/history`
- 浏览器可用（同源 localhost 无 CORS 问题）；`JobController` 提供 `reportProgress(id, p)`

### 5.3 UI

- 设置 → ComfyUI：模板管理子面板（导入/命名/选择 prompt 节点/删除）
- 生成立绘/出图时，若使用 ComfyUI，任务进度条反映真实 step 进度

## 6. 分步实施计划

按依赖顺序拆任务，每步独立提交、测试全绿：

1. **能力接口 + JobController 骨架**：新建 `providers/capabilities/` 与 `createJobController`；`MediaCapability` 类型；`pluginStore.resolveProviderCapability`。旧 `MediaProvider` 保留。不改实现。
2. **迁移三个媒体 Provider 到能力清单 + JobController**：mock/comfyui/dashscope 改 `capabilities: string[]`，方法经 JobController 重构（行为不变）。迁移所有 `capabilities.xxx` 布尔访问点（integration、settings、storyboard）。
3. **调用点按能力解析**：`useShotActions.generateMedia` 与 `useCharacterFeatures.generatePortrait` 用 `resolveInstanceCapability`；`StoryboardPanel`/`ShotEditor` 能力相关 UI 文案同步。
4. **FeaturePlugin 落地**：类型扩展；7 个模块插件文件；modules 动态化；AppShell/SideNav 改造；register 注册；测试更新。
5. **ComfyUI 模板管理器**：workflowStore + 自动识别节点 + 设置 UI + 配置字段改模板 id。
6. **ComfyUI WebSocket 进度**：ws 连接 + 进度上报 + 轮询回退；JobController.reportProgress。
7. **收尾**：README 更新、`docs/plans/2026-08-17-plugin-refactor-implementation.md` 详细实施计划、最终全量验证。

## 7. 兼容与风险

- 能力重构与 FeaturePlugin 均保持现有测试通过（模块结果不变）。
- `ProviderPlugin.capabilities` 类型变更（位图→数组）是破坏性变更，集中在步骤 2/3 一次迁移。
- ComfyUI ws 在 jsdom 无实现，测试用 stub；真实连接仅浏览器运行。
- 每步提交均跑 `npm test` + `npm run typecheck` + `npm run build`。

## 8. 验证清单

- [ ] `npm test` 全绿（现有 217 + 新增）
- [ ] 设置页 Provider 能力以清单展示；选中 ComfyUI 后角色生成立绘走 ComfyUI
- [ ] 新增一个模块仅需写 FeaturePlugin + 注册一行（示例：一个 hello 模块可临时验证后删除）
- [ ] ComfyUI 模板管理器可导入 Qwen 工作流并自动识别提示词/seed 节点
- [ ] README 描述能力清单与模块插件化
