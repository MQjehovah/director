import type { AgentSkill } from './skillStore'

const PLACEHOLDER_REGEX = /\{\{(\w+)\}\}/g

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_REGEX, (match, key: string) =>
    key in vars ? vars[key] : match,
  )
}

export function templatePlaceholders(template: string): string[] {
  const names: string[] = []
  const re = new RegExp(PLACEHOLDER_REGEX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

const ROLE_CARD_TEMPLATE = `请根据以下信息生成一份完整的角色设定卡：

- 外貌：{{appearance}}
- 性格：{{personality}}
- 背景：{{background}}

请补充角色的口头禅、服装细节、核心动机与成长弧线，并以结构化列表输出。`

const STORYBOARD_TEMPLATE = `请为以下场景编写分镜描述：

- 场景：{{scene}}
- 镜头类型：{{shotType}}

请输出画面构图、人物动作、光线氛围、运镜方式，并给出该镜头的建议时长。`

const IMAGE_PROMPT_TEMPLATE = `请将以下概念扩展为一段可用于 AI 文生图的提示词：

- 主体：{{subject}}
- 风格：{{style}}

输出应包含主体、环境、光照、镜头与风格关键词，并附带负面提示词建议。`

const EDIT_PROMPT_TEMPLATE = `请将以下改图指令转换为清晰的图像编辑步骤：

{{instruction}}

输出应说明需保持不变的部分、需要修改的部分，以及建议的编辑参数。`

function templateSkill(
  id: string,
  name: string,
  description: string,
  template: string,
): AgentSkill {
  return {
    id,
    name,
    description,
    kind: 'prompt-template',
    builtIn: true,
    enabled: true,
    template,
  }
}

export function builtinPromptTemplates(): AgentSkill[] {
  return [
    templateSkill('role-card', '角色设定卡', '用于生成角色设定卡文案', ROLE_CARD_TEMPLATE),
    templateSkill('storyboard-prompt', '分镜描述模板', '用于编写分镜画面描述', STORYBOARD_TEMPLATE),
    templateSkill('image-prompt', '文生图提示词模板', '用于将概念扩展为文生图提示词', IMAGE_PROMPT_TEMPLATE),
    templateSkill('edit-prompt', '改图指令模板', '用于将自然语言转换为改图指令', EDIT_PROMPT_TEMPLATE),
  ]
}
