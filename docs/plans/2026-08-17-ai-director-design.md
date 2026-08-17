# AI导演台 — 前端设计文档

日期：2026-08-17
状态：已定稿

## 1. 项目概述

AI导演台的前端项目，用于导演/创作者编排 AI 漫剧（动画短剧）。后端可对接多种多模态大模型/API、本地模型和 ComfyUI。前端核心围绕**角色编辑、脚本编辑、切镜、编排**四大能力构建。

## 2. 需求确认

| 维度 | 决策 |
|------|------|
| 技术栈 | Vue 3 + Vite + TypeScript |
| UI | shadcn/vue + Tailwind CSS |
| 产品形态 | 纯前端 + mock，可对接真实后端/本地服务 |
| 核心模块 | 角色编辑器、剧本编辑器、镜头编排、成片预览、任务队列 |
| 后端对接 | API 适配层 + 可切换 mock（默认实现 mock） |
| 持久化 | 本地持久化为主（IndexedDB） |
| 成片形式 | 图片分镜 + 配音→视频 与 视频片段拼接，两者都支持 |
| AI 角色 | 多环节 AI 辅助 + 媒体生成 + 一键全流程 |
| 部署形态 | 静态构建，可桌面可 Web |
| 架构 | **插件化分层**（内核 + Provider 能力插件 + 功能插件 + 管道插件） |

## 3. 架构

### 3.1 插件化分层

```
src/
├── core/                # 稳定内核（不依赖插件）
│   ├── models/          # 领域模型：角色/剧本/分镜/镜头/任务/项目
│   ├── plugin/          # 插件系统核心
│   │   ├── registry.ts  # 插件注册表（按类型注册）
│   │   ├── types.ts     # 插件接口定义
│   │   └── manager.ts   # 插件生命周期管理
│   └── bus.ts           # 事件总线（插件间通信）
├── providers/           # 内核内置 Provider 接口
│   ├── MediaProvider    # 媒体生成（图/视频）
│   ├── LLMProvider      # 文本/AI 对话
│   ├── TTSProvider      # 配音
│   └── StorageProvider  # 持久化
├── plugins/             # 内置插件
│   ├── providers/       # mock / http-backend / comfyui / local-model
│   ├── features/        # 功能插件：角色/剧本/分镜/预览/任务
│   └── pipeline/        # 一键全流程编排插件
├── components/          # 通用 UI（shadcn/vue）
└── features/            # 页面层（装配插件能力）
```

### 3.2 插件化设计要点

- **能力接口（Provider）**：`MediaProvider`、`LLMProvider`、`TTSProvider`、`StorageProvider`。每种提供方（mock、HTTP 后端、ComfyUI、本地模型）都是某接口的实现插件。
- **功能插件（FeaturePlugin）**：角色编辑器、剧本编辑器、分镜编排等作为可插拔模块，通过注册表装配，可独立启用/停用。
- **管道插件（PipelinePlugin）**：一键全流程 = 多个能力插件按顺序编排，用户可自定义流程步骤。
- **UI 插件化**：每个能力插件可声明「设置面板」和「调用入口」，自动挂载到界面。新增模型只需写一个插件文件。

## 4. 领域模型

| 模型 | 说明 |
|------|------|
| `Character` | 角色：id、name、appearance、referenceImages[]、voice、loraConfig、tags、metadata |
| `Script` | 剧本：id、title、scenes[Scene]、synopsis、globalContext |
| `Scene` | 场：id、title、location、timeOfDay、beats[Beat] |
| `Beat` | 节拍/镜次：id、type(shot/dialogue/action/sfx)、dialogue、action、shotRef |
| `Shot` | 镜头：id、beatRef、shotType(image/video)、camera{shotSize, angle, move, duration}、prompt、negativePrompt、seed、mediaAssets[]、renderJobRef |
| `Asset` | 媒体资产：id、kind(image/video/audio/lora/ref)、url、localPath、thumbUrl、source |
| `Job` | 任务：id、type、status(queued/running/done/failed/canceled)、progress、pluginId、params、result、createdAt |
| `Project` | 项目：id、name、meta、characterIds、scriptId、storyboardRefs |

### 关键设计

- 镜头不直接挂媒体，通过 `renderJobRef` → `Job` → 产出 `Asset`，保证「排队→生成→出片」可追踪。
- `Beat` 与 `Shot` 分离：剧本只关心叙事（节拍），切镜把节拍映射到镜头，支持「一拍多镜」。
- 所有模型用 zod 定义 schema，供类型推导、校验、mock 复用。

## 5. API 适配层与任务系统

### Provider 接口

```ts
interface MediaProvider {
  id; name;
  capabilities: { text2image; image2video; text2video; upscale }
  generateImage(params): Promise<Job>
  generateVideo(params): Promise<Job>
  getJob(id): Promise<JobStatus>
  onJobUpdate(cb): void
}

interface LLMProvider {
  id; name;
  chat(messages): AsyncIterable<string>   // 流式
  complete(prompt, params): Promise<string>
  models: ModelOption[]
}

interface TTSProvider {
  id; name;
  synthesize(text, voice): Promise<Job>
}

interface StorageProvider {
  id; name;
  loadProject(id); saveProject(proj); listProjects(); deleteProject(id)
  saveAsset(file): Promise<Asset>; getAssetUrl(asset)
}
```

### 默认实现插件

| 插件 | 说明 |
|------|------|
| `storage-indexeddb` | 本地持久化（IndexedDB，项目+资产元数据） |
| `media-mock` / `llm-mock` / `tts-mock` | 开发用假实现（延迟模拟 + 占位图） |
| `media-http` | 对接真实后端 REST（/jobs、/generate、/assets） |
| `media-comfyui` | 直连本地 ComfyUI /prompt + /history，含工作流 JSON 模板 |
| `llm-http` | 对接 OpenAI 兼容协议（/chat/completions） |

### 任务系统

- `JobStore`：状态机 `queued → running → done/failed/canceled`
- 支持轮询与 WebSocket/SSE 订阅两种进度获取方式
- 结果统一落为 `Asset`，自动入库到当前镜头
- 进度面板 = `JobStore` 的响应式视图

### 配置中心

- 设置页管理各 Provider 地址/密钥/参数，存本地
- 每个 Provider 可独立启停，界面自动反映可用能力

## 6. 功能模块

### 6.1 角色编辑器
- 卡片网格 + 详情抽屉：外貌描述、参考图（多张）、音色、LoRA、标签
- 内置 `llm` 能力：AI 生成角色设定 / 参考图扩写，结果可编辑
- 调用 `media` 能力：生成角色立绘/参考图（绑定到 asset）

### 6.2 剧本编辑器
- 左侧场次列表，中间场景编辑区：叙事节拍序列（对话/动作/音效）
- Markdown 导入、AI 生成剧本、AI 改写节拍
- 工具栏：「一键切分为镜头」→ 生成 Shot

### 6.3 镜头编排
- 镜头缩略图网格（storyboard 视图）+ 可拖拽重排
- 选中镜头：右侧编辑面板（镜头类型、机位/景别/运镜、提示词、种子、时长）
- 「生成媒体」→ 创建 Job → 预览占位 → 完成后替换为真实资产
- 时间轴视图：镜头序列 + 时长条，用于成片顺序控制

### 6.4 成片预览
- 时间轴播放器：图片镜头（Ken Burns 运镜效果 + 字幕）+ 视频镜头拼接
- 字幕轨、音频轨（TTS 配音）叠加
- 可导出成片参数 / 预览 URL

### 6.5 任务队列面板
- 侧栏抽屉：任务列表（状态、进度、插件、所属镜头）
- 操作：取消、重试、定位到对应镜头
- 插件级进度订阅展示

### 6.6 一键全流程（composer）
- 管道编辑器：拖拽步骤（生成剧本→切分镜头→生成角色→出图→配音→组装）
- 每步绑定 Provider 插件，支持预览/执行/跳过

## 7. UI 布局

```
┌─────────────────────────────────────────────────────┐
│ 顶栏：项目名 | 保存状态 | Provider 状态 | 设置 | 导出 │
├──────────┬──────────────────────────────────────────┤
│ 左侧导航  │  主工作区（按模块切换）                     │
│ · 角色    │                                          │
│ · 剧本    │                                          │
│ · 分镜    │  右侧：上下文面板（选中对象属性编辑）        │
│ · 成片    │                                          │
│ · 任务 ▾  │                                          │
│ · 全流程  │                                          │
├──────────┴──────────────────────────────────────────┤
│ 底部：任务队列进度条 / 状态栏                          │
└─────────────────────────────────────────────────────┘
```

## 8. 数据流

- **单向数据流**：Pinia store（领域状态）← Provider（数据来源）← 本地缓存
- 编辑操作写 store → 防抖自动保存到 `StorageProvider`（IndexedDB）
- 生成操作 → `JobStore` 创建任务 → Provider 执行 → 回调更新 store

## 9. 错误处理

- Provider 调用统一错误码（网络/认证/超时/生成失败/资源不足）
- 任务失败 → 任务面板标红 + 一键重试；镜头占位图保持可替换
- 无后端时可全程 mock，保证流程可演示

## 10. 测试策略

- 领域模型：Vitest 单元测试（schema 校验、状态机）
- 插件注册/管线：Vitest 单元测试（mock provider 端到端跑通）
- 组件：Vitest + Vue Test Utils，关键路径测试（切镜、生成流程）
- E2E 暂缓，MVP 后补

## 11. 技术选型清单

| 类别 | 选型 |
|------|------|
| 框架 | Vue 3.4+ + Vite + TypeScript |
| 状态 | Pinia |
| UI | shadcn/vue + Tailwind CSS |
| 校验 | zod |
| 测试 | Vitest + Vue Test Utils |
| 存储 | IndexedDB（原生 API 封装或 Dexie） |
| 拖拽 | 轻量方案（原生 HTML5 DnD 或 @vueuse/integrations） |
| 工具 | VueUse、unplugin-auto-import |
