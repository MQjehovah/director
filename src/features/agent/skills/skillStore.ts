import { builtinPromptTemplates } from './promptTemplates'

export type SkillKind = 'prompt-template' | 'project-tool' | 'skill-md' | 'comfyui-workflow'

export interface AgentSkill {
  id: string
  name: string
  description: string
  kind: SkillKind
  builtIn?: boolean
  enabled: boolean
  template?: string
  toolName?: string
  markdown?: string
  workflowId?: string
}

const STORAGE_KEY = 'ai-director:agent-skills'

const DIRECTOR_VOICE_MARKDOWN = `作为 AI导演台的 AI 导演助手，应始终以专业导演的口吻、简洁直接地与用户交流。

# 风格要点

- 先给结论，再补充细节。
- 分镜与镜头建议使用具体的电影语言：景别、运镜、光线、节奏。
- 创作类内容（剧本、角色、提示词）优先产出可直接使用的成品，而非教学式说明。
- 使用中文影视术语（如「镜头」「分镜」「景别」）。
- 调用工具前用一句话说明意图，工具完成后用简洁中文总结结果。

# 协作约定

- 不确定用户意图时，先给出一个合理的默认方案，并说明可调整项。
- 涉及角色或剧本改动时，提示用户可用的一键应用入口。`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAgentSkill(value: unknown): value is AgentSkill {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.enabled === 'boolean' &&
    (value.kind === 'prompt-template' ||
      value.kind === 'project-tool' ||
      value.kind === 'skill-md' ||
      value.kind === 'comfyui-workflow')
  )
}

function builtinSkills(): AgentSkill[] {
  return [
    ...builtinPromptTemplates(),
    {
      id: 'director-voice',
      name: '导演风格指南',
      description: 'AI导演台 AI 助手应遵循的导演风格与回复基调。',
      kind: 'skill-md',
      builtIn: true,
      enabled: true,
      markdown: DIRECTOR_VOICE_MARKDOWN,
    },
  ]
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function readAll(): AgentSkill[] {
  const raw = readRaw()
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAgentSkill)
  } catch {
    return []
  }
}

function writeAll(skills: AgentSkill[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skills))
  } catch {
    // storage may be unavailable (privacy mode / quota); ignore silently
  }
}

function ensureBuiltinSkills(): void {
  // key 缺失或内容损坏（解析失败/被过滤为空）时重新播种，避免用户永久失去内置技能
  if (readRaw() === null) {
    writeAll(builtinSkills())
    return
  }
  if (readAll().length === 0) {
    writeAll(builtinSkills())
  }
}

export function listSkills(): AgentSkill[] {
  ensureBuiltinSkills()
  return readAll()
}

export function saveSkill(skill: AgentSkill): void {
  ensureBuiltinSkills()
  const skills = readAll()
  const idx = skills.findIndex((s) => s.id === skill.id)
  if (idx >= 0) skills[idx] = skill
  else skills.push(skill)
  writeAll(skills)
}

export function getSkill(id: string): AgentSkill | undefined {
  return listSkills().find((s) => s.id === id)
}

export function toggleSkill(id: string): void {
  const skill = getSkill(id)
  if (!skill) return
  saveSkill({ ...skill, enabled: !skill.enabled })
}

export function deleteSkill(id: string): void {
  ensureBuiltinSkills()
  const skills = readAll()
  const target = skills.find((s) => s.id === id)
  if (!target || target.builtIn) return
  writeAll(skills.filter((s) => s.id !== id))
}

export function resetSkillsForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  writeAll(builtinSkills())
}

// project-tool skills are not persisted here: they are the live AgentTool[] handed to the
// agent engine at panel setup. The drawer derives its project-tool entries from the tool
// registry via getProjectToolSkills, so skillStore only persists prompt-template /
// skill-md / comfyui-workflow skills.
export function getProjectToolSkills(tools: Array<{ name: string; description: string }>): AgentSkill[] {
  return tools.map((tool) => ({
    id: `tool-${tool.name}`,
    name: tool.name,
    description: tool.description,
    kind: 'project-tool',
    enabled: true,
    toolName: tool.name,
  }))
}
