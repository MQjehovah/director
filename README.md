# AI导演台 (AI Director Console)

一个面向 AI 漫剧（动画短剧）制作的导演台前端。通过插件化的 Provider 体系，前端可对接各种多模态大模型 / API、本地模型与 ComfyUI，覆盖「角色 → 剧本 → 分镜 → 生成 → 成片」的完整编排流程。

## 功能

- **角色管理**：角色卡片网格、外貌描述、参考图、音色、LoRA、标签；AI 生成角色设定、扩写参考图提示词、生成立绘。
- **剧本编辑器**：场次 + 叙事节拍（对话 / 动作 / 音效）；Markdown 导入、AI 生成剧本、AI 改写节拍、一键切分镜头。
- **分镜设计**：镜头缩略图网格 + 拖拽重排；镜头类型（静态图 / 视频）、景别 / 机位 / 运镜 / 时长、提示词与随机种子；生成媒体任务与进度展示。
- **成片合成**：时间轴播放器，静态镜头 Ken Burns 运镜 + 字幕，视频镜头直接播放；进度条与镜头点击定位。
- **任务队列**：全局任务列表（状态、进度、所属镜头、插件），支持取消 / 重试 / 定位。
- **一键全流程**：管道化执行「生成剧本 → 切分镜头 → 生成角色 → 出图 → 配音 → 组装」，每步可启用 / 跳过 / 排序。
- **设置**：各 Provider 的启停与地址 / 密钥 / 模型参数配置，持久化到本地。

## 快速开始

```bash
npm install
npm run dev       # 开发模式（默认使用 mock Provider，无需任何后端）
npm test          # 单元测试（Vitest）
npm run build     # 生产构建
npm run preview   # 预览构建产物
```

默认启用全部 mock Provider，打开浏览器即可无后端走通完整流程。

## 架构

```
src/
├── core/                # 稳定内核
│   ├── models/          # zod 领域模型（角色/剧本/镜头/任务/项目/资产）
│   ├── plugin/          # 插件系统（注册表/管理器/类型）
│   └── bus.ts           # 类型化事件总线
├── providers/           # Provider 能力接口
│   ├── MediaProvider    # 媒体生成（文生图/图生视频/文生视频/超分）
│   ├── LLMProvider      # 文本 / AI 对话
│   ├── TTSProvider      # 配音
│   └── StorageProvider  # 持久化
├── plugins/
│   ├── providers/       # 内置实现：mock / IndexedDB 存储
│   └── register.ts      # 应用启动时注册全部插件
├── stores/              # Pinia 状态（project/character/script/storyboard/job/plugin）
├── features/            # 业务功能模块（characters/script/storyboard/player/jobs/composer/settings）
└── components/          # UI 基础件 + 布局
```

### 插件机制

能力提供方（Provider）以插件形式接入，通过 `PluginRegistry` 注册，`PluginStore` 解析启用实例：

- **能力接口**：`MediaProvider`、`LLMProvider`、`TTSProvider`、`StorageProvider` 各定义一个插件实现。
- **可切换**：UI 通过 `pluginStore.mediaProvider` / `llmProvider` 等计算属性拿到当前启用的实例；无后端时全部使用 mock。
- **配置持久化**：每个 Provider 的启停与参数保存于 localStorage（前缀 `ai-director:provider:`），启动时自动应用。

### 添加自定义 Provider 插件

1. 在 `src/plugins/providers/` 新建文件，实现对应能力接口，并导出 `createXxxPlugin()`（返回 `ProviderPlugin<T>`）。
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

## 后端对接指南

| 对接方式 | Provider | 说明 |
|----------|----------|------|
| 无后端（默认） | mock | 本地假实现，延迟模拟 + 占位图，便于开发与演示 |
| OpenAI 兼容协议 | `llm-http` | 已内置：设置页填写地址（如 `https://api.deepseek.com/v1`）、密钥、模型名后「设为当前使用」即可；浏览器直连受 CORS 限制时需配代理 |
| 真实 REST 后端 | `media-http`（预留） | 在设置页配置 baseUrl / token / model，按 `llm-http` 模式实现 |
| 本地 ComfyUI | `media-comfyui`（预留） | 直连 `/prompt` + `/history`，工作流 JSON 模板 |
| 本地模型 | 同上述 Provider | 通过本地服务地址接入 |

> 当前内置实现为 mock 与 IndexedDB 存储；`media-http` / `media-comfyui` 为预留接口，按上表约定即可接入。

## 技术栈

Vue 3 · Vite · TypeScript · Pinia · Tailwind CSS · zod · Dexie · Vitest · Vue Test Utils

## 目录

- 设计文档：`docs/plans/2026-08-17-ai-director-design.md`
- 实施计划：`docs/plans/2026-08-17-ai-director-implementation.md`
