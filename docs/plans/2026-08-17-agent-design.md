# Agent 系统设计 — AI导演台

日期：2026-08-17
状态：待评审

## 1. 目标

在 AI导演台 中实现一个**前端驱动**的 Agent：用户通过自然语言对话指挥 agent 完成剧本创作、分镜设计、角色设定、提示词生成等任务。大模型通过现有 Provider 体系（`llm-http` 等 OpenAI 兼容接口）调用，不新增后端。**本阶段不接 MCP**（技术约束：MCP 走 TCP/stdio，浏览器无法直连）。

## 2. 需求确认

| 维度 | 决策 |
|------|------|
| Agent 架构 | 前端驱动对话循环，大模型走 Provider（llm-http） |
| MCP | 本阶段不接（后续可用 SSE/HTTP transport 或本地代理） |
| 技能类型 | 提示词模板技能包、项目内工具调用、SKILL.md 风格技能、ComfyUI 工作流技能（四类全要） |
| 交互 | 对话面板 + 结果可一键应用 |

## 3. 架构

```
src/features/agent/
├── core/
│   ├── types.ts          # AgentMessage / AgentTool / AgentSkill / AgentTurn 等类型
│   ├── agent.ts          # 对话循环：构建 system prompt → 调 LLM → 解析工具调用 → 执行 → 汇总
│   └── parser.ts         # 工具调用标记解析（结构化文本标记，兼容本地模型）
├── skills/
│   ├── skillStore.ts     # 技能注册表（localStorage 持久化）
│   ├── promptTemplates.ts# 提示词模板技能包（内置 + 可安装）
│   ├── projectTools.ts   # 项目内工具（生成剧本/切镜/立绘/提示词）
│   ├── skillMd.ts        # SKILL.md 风格技能解析/执行
│   └── comfyuiSkills.ts  # ComfyUI 工作流技能（复用 workflowStore）
├── agentPanel/
│   ├── AgentPanel.vue    # 对话面板（FeaturePlugin）
│   ├── MessageBubble.vue # 单条消息 + 可应用的结果卡片
│   └── SkillDrawer.vue   # 技能管理抽屉
└── __tests__/
```

### 3.1 对话循环（core/agent.ts）

```
用户消息 → 组装 messages = [system(技能+工具描述), ...历史, 用户消息]
       → llm.chat(messages) 流式接收
       → 完整输出后解析工具调用标记 [[tool:name(key=value)]]
       → 逐个执行工具（ProjectTools / Skill 内容检索）
       → 工具结果以 assistant 工具消息回填，再调一轮 llm 汇总
       → 产出 AgentTurn { userMessage, assistantText, toolCalls[], results[], applied }
```

- 单轮内最多执行 N 个工具（防循环，N=5 默认）。
- 上下文窗口控制：保留最近 ~20 条消息，超出截断。

### 3.2 工具调用协议（core/parser.ts）

为兼容本地模型（部分不支持原生 function calling），采用**结构化文本标记**：

```
[[tool:generate_script(idea=都市少年与AI伙伴)]]
[[tool:generate_portrait(character=小明, style=<anime>)]]
[[tool:cut_scene(sceneId=sc-1)]]
[[tool:expand_prompt(prompt=银发剑士, style=<portrait>)]]
```

- 解析器：正则匹配 `\[\[tool:(\w+)\(([^)]*)\)\]\]`，参数解析 `key=value`（value 可含引号）。
- agent 的 system prompt 明确告知工具格式。
- 无法识别/执行失败的工具 → 结果回填为错误说明，agent 继续。

### 3.3 技能系统（skills/）

技能统一模型：

```ts
type SkillKind = 'prompt-template' | 'project-tool' | 'skill-md' | 'comfyui-workflow'

interface AgentSkill {
  id: string
  name: string
  description: string          // agent 可见的技能说明
  kind: SkillKind
  builtIn?: boolean            // 内置不可删；可安装的技能 builtIn=false
  enabled: boolean
  // kind 相关负载
  template?: string            // prompt-template：提示词模板（含 {{placeholders}}）
  tool?: AgentToolRef          // project-tool：绑定项目内工具
  markdown?: string            // skill-md：SKILL.md 内容
  workflowId?: string          // comfyui-workflow：workflowStore 的模板 id
}
```

- **skillStore**：`listSkills() / saveSkill() / deleteSkill() / toggleSkill()`，localStorage key `ai-director:agent-skills`。内置技能初始化时写入（builtIn=true）。
- **prompt-template**：内置常用模板（角色设定、分镜描述、改图指令、文生图提示词）。`{{placeholders}}` 在注入 system prompt 时按当前上下文提示。可安装 = 用户在技能抽屉粘贴新模板保存。
- **project-tool**：绑定项目内能力，如 `generate_script` / `cut_scene` / `generate_portrait` / `generate_shot_media`。agent 调用时经 tool 分发到对应 features composable。
- **skill-md**：用户可粘贴 Markdown 技能说明（如 Claude SKILL.md 风格），解析为 `description`（首段）+ `markdown`（全文），agent 按需加载全文作为上下文。
- **comfyui-workflow**：绑定 `workflowStore` 中已保存的工作流模板。agent 选用它 = 向用户展示该工作流可用于哪类任务（如 Qwen 改图 → 「改图」任务），一键应用到 ComfyUI 生成。

### 3.4 项目内工具（skills/projectTools.ts）

复用现有 features composables：

| 工具 | 动作 |
|------|------|
| `generate_script(idea)` | useScriptFeatures.generateScriptFromIdea + importScript |
| `cut_scene(sceneId)` | useScriptFeatures.cutSceneToShots |
| `generate_portrait(character, style?)` | useCharacterFeatures.generatePortrait（需先存在角色；无则提示创建） |
| `generate_shot_media(shotId)` | useShotActions.generateMedia |
| `expand_prompt(text, style?)` | useCharacterFeatures.expandReferencePrompt 或模板填充 |
| `import_workflow(name, graphJson)` | workflowStore.importWorkflowGraph + save |

### 3.5 一键应用

- 对话结果卡片（MessageBubble）带「应用」按钮：把 agent 产出填入对应位置。
- 应用目标由工具结果声明（`applyTarget: { kind: 'script'|'prompt'|'portrait'|'shot', id?, text }`）。
- 例如：`generate_script` 结果 → 应用 = 已导入剧本（直接生效）；`expand_prompt` 结果 → 应用 = 填入角色 imagePrompt / 镜头 prompt。

## 4. 对话面板 UI

- 新 FeaturePlugin「AI 助手」（key `agent`，order 8）。
- 布局：消息列表（流式打字机效果）+ 底部输入框 + 技能抽屉入口（✨ 或 📦 图标）。
- 消息气泡：assistant 文本 + 工具调用摘要（`🔧 generate_script`）+ 可应用卡片。
- 顶栏显示当前 LLM Provider 名（无 Provider 时提示去设置配置）。

## 5. 测试策略

- core/parser：工具标记解析（含引号/中文/多工具/非法格式）。
- core/agent：mock LLM（stub）驱动对话循环，验证工具调用 → 执行 → 汇总链路。
- skills：skillStore CRUD/持久化；prompt-template 占位符；skill-md 解析；comfyui 技能绑定。
- agentPanel：渲染消息、工具摘要、一键应用按钮。

## 6. 实施步骤

1. **core/agent 骨架**：types + parser + agent 对话循环（stub LLM 可测）。
2. **skills**：skillStore + prompt-templates + skill-md 解析 + comfyui 绑定 + project-tools。
3. **对话面板**：AgentPanel FeaturePlugin + 消息流 + 技能抽屉 + 一键应用。
4. **集成**：注册插件、接线、测试全绿、README。

## 7. 验证清单

- [ ] 配置 llm-http 后，对话「帮我写一个三幕剧开头」→ agent 调用 generate_script → 剧本入库
- [ ] 「给小明生成立绘，动漫风格」→ 触发 generate_portrait → 参考图出现
- [ ] 技能抽屉可安装/停用模板技能与 SKILL.md，agent 描述随之更新
- [ ] ComfyUI 工作流技能可选用于对应任务
- [ ] 全部测试通过（现有 ~291 + 新增）
