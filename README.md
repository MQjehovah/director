# AI导演台 (AI Director Console)

一个面向 AI 漫剧（动画短剧）制作的导演台前端。通过插件化的 Provider 体系，前端可对接各种多模态大模型 / API、本地模型与 ComfyUI，覆盖「角色 → 剧本 → 分镜 → 生成 → 成片」的完整编排流程。

## 功能

- **项目管理**：顶栏项目下拉，多项目新建 / 切换 / 重命名 / 删除，各项目独立工作区，自动持久化到本地。
- **AI 助手**：对话面板驱动 Agent，用自然语言指挥「生成剧本 / 创建角色 / 切分镜头 / 生成立绘 / 扩写提示词 / 导入 ComfyUI 工作流」；技能系统（提示词模板包、项目工具、SKILL 文档、ComfyUI 工作流）可安装与启停，结果可一键应用。
- **角色管理**：角色卡片网格、外貌描述、参考图（上传 / AI 生成）、音色、LoRA、标签；AI 生成角色设定、扩写参考图提示词、生成立绘。
- **剧本编辑器**：场次 + 叙事节拍（对话 / 动作 / 音效）；Markdown 导入、AI 生成剧本、AI 改写节拍、一键切分镜头。
- **分镜设计**：镜头缩略图网格 + 拖拽重排；镜头类型（静态图 / 视频）、景别 / 机位 / 运镜 / 时长、提示词与随机种子；视频镜头支持上传首帧 / 尾帧做首尾帧文生视频；生成媒体任务与进度展示。
- **成片合成**：时间轴播放器，静态镜头 Ken Burns 运镜 + 字幕，视频镜头直接播放；进度条与镜头点击定位。
- **任务队列**：全局任务列表（状态、进度、所属镜头、插件），支持取消 / 重试 / 定位。
- **一键全流程**：管道化执行「生成剧本 → 切分镜头 → 生成角色 → 出图 → 配音 → 组装」，每步可启用 / 跳过 / 排序。
- **设置**：按 Provider 分组，启停开关 + 展开配置详情（地址 / 密钥 / 模型）；ComfyUI 工作流模板管理内嵌于 ComfyUI Provider，支持粘贴 JSON、从本地 .json 文件导入（自动识别 API / 前端格式）或直接连接 ComfyUI 拉取已保存的工作流。

## 快速开始

```bash
npm install
npm run dev       # 开发模式
npm test          # 单元测试（Vitest）
npm run build     # 生产构建
npm run preview   # 预览构建产物
```

未配置真实 Provider 时，角色 / 剧本 / 分镜等流程可用（生成类能力需先在「设置」配置 LLM / 媒体 Provider）。

## 架构

```
src/
├── core/                # 稳定内核
│   ├── models/          # zod 领域模型（角色/剧本/镜头/任务/项目/资产）
│   ├── plugin/          # 插件系统（注册表/管理器/类型/模块收集）
│   └── bus.ts           # 类型化事件总线
├── providers/           # 能力接口
│   ├── capabilities/    # 媒体能力接口（文生图/文生视频/图生视频/改图/超分）+ JobController
│   ├── LLMProvider      # 文本 / AI 对话
│   ├── TTSProvider      # 配音
│   └── StorageProvider  # 持久化
├── plugins/
│   ├── providers/       # 后端实现：mock / ComfyUI / DashScope / IndexedDB / HTTP LLM
│   ├── features/        # 功能模块插件（角色/剧本/分镜/成片/任务/全流程/设置）
│   └── register.ts      # 应用启动时注册全部插件（Provider + Feature + Pipeline）
├── stores/              # Pinia 状态（project/character/script/storyboard/job/plugin）
├── features/            # 业务功能（characters/script/storyboard/player/jobs/composer/settings/comfyui）
└── components/          # UI 基础件 + 布局
```

### 插件机制

**Provider = 后端连接，能力 = 后端能做的事**。Provider 数量 = 后端数量；每个 Provider 声明自己实现的能力清单：

- **能力接口**：媒体能力拆分为 `text2image` / `text2video` / `image2video` / `editImage` / `upscale`，每个能力一个接口。Provider 声明 `capabilities: string[]` 说明实现哪些能力；`pluginStore.resolveInstanceCapability('media', 'text2image')` 按需解析——例如 active 是 DashScope（仅文生图）时，视频镜头会回退到其他启用的文生视频 Provider。
- **模块插件化（FeaturePlugin）**：8 个功能模块全部是 FeaturePlugin，每个插件声明 `module { key, label, title, order }` + `component`。导航与主区由 `pluginStore.featureModules()` / `featureComponent(key)` 动态渲染。**新增模块 = 写一个插件文件 + 注册一行**，无需改 AppShell。
- **配置持久化**：每个 Provider 的启停与参数保存于 localStorage（前缀 `ai-director:provider:`），启动时自动应用。
- **任务生命周期**：媒体 Provider 复用 `createJobController`（任务注册 / 轮询 / 监听 / 取消 / 终态不可变），避免各实现重复手写。

### 添加自定义 Provider 插件

1. 在 `src/plugins/providers/` 新建文件，实现对应**能力接口**（如 `TextToImageCapability`），组合 `createJobController`，导出 `createXxxPlugin()`（返回 `ProviderPlugin<T>`，声明 `capabilities` 数组与 `configFields`）。
2. 在 `src/plugins/register.ts` 的 `buildAppPlugins()` 中注册。

示例（对接 OpenAI 兼容接口的 LLM）：

```ts
// src/plugins/providers/llm-http.ts
import type { ProviderPlugin } from '../../core/plugin/types'
import type { LLMProvider } from '../../providers/LLMProvider'

export function createLLMHttpPlugin(): ProviderPlugin<LLMProvider> {
  const instance: LLMProvider = {
    id: 'llm-http',
    name: 'HTTP LLM',
    models: [{ id: 'qwen', name: '通义千问' }],
    async chat(messages) {
      // 流式对接 /chat/completions
      yield* streamCompletion(messages)
    },
    async complete(prompt) {
      // 一次性完成
      return fetchCompletion(prompt)
    },
  }
  return { id: 'llm-http', name: 'HTTP LLM', kind: 'provider', providerType: 'llm', enabled: true, instance }
}
```

### 添加自定义功能模块

```ts
// src/plugins/features/hello.ts
import { defineComponent } from 'vue'
import type { FeaturePlugin } from '../../core/plugin/types'

export function createHelloFeaturePlugin(): FeaturePlugin {
  return {
    id: 'feature-hello',
    name: '示例',
    kind: 'feature',
    featureId: 'hello',
    enabled: true,
    module: { key: 'hello', label: '示例', title: '示例模块', order: 99 },
    component: defineComponent({ render: () => 'Hello' }),
  }
}
```

在 `register.ts` 的 `buildAppPlugins()` 中 `registry.register(createHelloFeaturePlugin())`，导航与主区自动出现该模块。

### 添加自定义管道步骤

1. 在 `src/plugins/pipeline/` 新建文件，实现 `PipelineStep`（`run(ctx)` 内可读 `ctx.input`、写 `ctx.setResult` / `ctx.fail`），导出 `createXxxPipelinePlugin()`。
2. 在 `src/plugins/register.ts` 的 `buildAppPlugins()` 中注册一行。

示例：

```ts
// src/plugins/pipeline/hello.ts
import type { PipelinePlugin } from '../../core/plugin/types'

export function createHelloPipelinePlugin(): PipelinePlugin {
  return {
    id: 'pipeline-hello',
    name: '示例',
    kind: 'pipeline',
    enabled: true,
    step: {
      kind: 'hello',
      label: '示例步骤',
      order: 99,
      factory: () => ({
        id: 'hello',
        title: '示例步骤',
        run: async (ctx) => {
          ctx.setResult('hello', { ok: true })
        },
      }),
    },
  }
}
```

注册后画布「添加节点」面板自动出现该步骤，可参与连线、排序与一键执行。

## 后端对接指南

| 对接方式 | Provider | 说明 |
|----------|----------|------|
| 无后端（默认） | mock | 本地假实现，延迟模拟 + 占位图，便于开发与演示 |
| OpenAI 兼容协议 | `llm-http` | 已内置：设置页填写地址（如 `https://api.deepseek.com/v1`）、密钥、模型名后「设为当前使用」即可；浏览器直连受 CORS 限制时需配代理 |
| 本地 ComfyUI | `media-comfyui` | 已内置：设置页填写地址（如 `http://127.0.0.1:8188`）→ 在「ComfyUI 工作流模板」粘贴 API 格式 JSON、从本地文件导入、或一键拉取该 ComfyUI 实例已保存的工作流（自动把前端 nodes 格式转为 API 格式并识别提示词/负向/seed 节点）→ 按能力分别选择「文生图 / 参考生图 / 文生视频 / 参考生视频 / 首尾帧视频」模板（未配置时回退到通用视频模板）→ 生成时走 ComfyUI，WebSocket 实时进度；模板支持 `{image}` / `{image_link}`（首帧）与 `{last_frame}` / `{last_frame_link}`（尾帧）占位符，未配置模板时自动用内置 MiniMax H3 工作流按首尾帧搭建 |
| 阿里云 DashScope / 通义万相 | `media-dashscope` | 已内置：设置页填写 API Key 与模型名（默认 `wanx-v1`），异步任务 + 轮询，生成立绘走通义万相 |
| 真实 REST 后端 | `media-http`（预留） | 按 `llm-http` / 能力接口模式实现 |
| 本地模型 | 同上述 Provider | 通过本地服务地址接入 |

> 能力接口：文生图 / 参考生图 / 文生视频 / 参考生视频 / 首尾帧生视频 / 超分各为一个能力，Provider 声明 `capabilities` 清单，前端按镜头需求解析（视频镜头有首尾帧 → 首尾帧生视频，仅有单帧 → 参考生视频，无帧 → 文生视频）。设置页每个 Provider 卡片内可管理其提供的能力，并为每个能力选择由哪个 Provider 提供（持久化到本地）。

## 技术栈

Vue 3 · Vite · TypeScript · Pinia · Tailwind CSS · zod · Dexie · Vitest · Vue Test Utils

## 目录

- 设计文档：`docs/plans/2026-08-17-ai-director-design.md`
- 实施计划：`docs/plans/2026-08-17-ai-director-implementation.md`
- 插件体系重构设计：`docs/plans/2026-08-17-plugin-refactor-design.md`
- Agent 系统设计：`docs/plans/2026-08-17-agent-design.md`
