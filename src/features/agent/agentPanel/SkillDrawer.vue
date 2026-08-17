<script setup lang="ts">
import { ref, watch } from 'vue'
import { Badge, Button, Dialog, Input, Switch, Textarea } from '../../../components/ui'
import { newId } from '../../../core/utils/id'
import { createProjectTools } from '../skills/projectTools'
import { comfyuiWorkflowSkills } from '../skills/comfyuiSkills'
import { parseSkillMarkdown } from '../skills/skillMd'
import {
  deleteSkill,
  getProjectToolSkills,
  listSkills,
  saveSkill,
  toggleSkill,
} from '../skills/skillStore'
import type { AgentSkill, SkillKind } from '../skills/skillStore'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const KIND_LABELS: Record<SkillKind, string> = {
  'prompt-template': '提示词模板',
  'project-tool': '项目工具',
  'skill-md': 'SKILL 文档',
  'comfyui-workflow': 'ComfyUI 工作流',
}

// 组合列表：skillStore 持久化技能（提示词模板 + SKILL 文档）+ 工作流模板派生技能 + 项目工具派生技能
function combinedSkills(): AgentSkill[] {
  const seen = new Set<string>()
  const all = [
    ...listSkills(),
    ...comfyuiWorkflowSkills(),
    ...getProjectToolSkills(createProjectTools()),
  ]
  return all.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
}

const skills = ref<AgentSkill[]>(combinedSkills())

function refresh(): void {
  skills.value = combinedSkills()
}

// 面板在 AppShell 中 KeepAlive，打开时重新计算，避免派生技能（工作流模板等）显示为旧列表
watch(
  () => props.open,
  (open) => {
    if (open) refresh()
  },
)

// 可持久化启停的技能：prompt-template / skill-md（存于 skillStore）。
// project-tool 随插件固定启用、comfyui-workflow 随工作流模板自动出现，均不提供启停开关。
function isToggleable(skill: AgentSkill): boolean {
  return skill.kind === 'prompt-template' || skill.kind === 'skill-md'
}

function isDeletable(skill: AgentSkill): boolean {
  return !skill.builtIn && (skill.kind === 'prompt-template' || skill.kind === 'skill-md')
}

function onToggle(skill: AgentSkill): void {
  toggleSkill(skill.id)
  refresh()
  emit('changed')
}

function onDelete(skill: AgentSkill): void {
  deleteSkill(skill.id)
  refresh()
  emit('changed')
}

const installName = ref('')
const installTemplate = ref('')
const installMdName = ref('')
const installMarkdown = ref('')
const installMessage = ref<{ kind: 'error' | 'success'; text: string } | undefined>(undefined)

function installPromptTemplate(): void {
  if (!installName.value.trim() || !installTemplate.value.trim()) {
    installMessage.value = { kind: 'error', text: '请填写技能名称与模板内容' }
    return
  }
  saveSkill({
    id: newId('skill'),
    name: installName.value.trim(),
    description: '',
    kind: 'prompt-template',
    enabled: true,
    template: installTemplate.value,
  })
  installName.value = ''
  installTemplate.value = ''
  installMessage.value = { kind: 'success', text: '提示词模板已安装' }
  refresh()
  emit('changed')
}

function installSkillMarkdown(): void {
  if (!installMdName.value.trim() || !installMarkdown.value.trim()) {
    installMessage.value = { kind: 'error', text: '请填写技能名称与 Markdown 内容' }
    return
  }
  saveSkill(parseSkillMarkdown(installMdName.value.trim(), installMarkdown.value))
  installMdName.value = ''
  installMarkdown.value = ''
  installMessage.value = { kind: 'success', text: 'SKILL.md 技能已安装' }
  refresh()
  emit('changed')
}
</script>

<template>
  <Dialog :open="open" title="技能管理" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">技能列表</h3>
        <ul class="mt-2 flex flex-col gap-2">
          <li
            v-for="skill in skills"
            :key="skill.id"
            class="flex items-center justify-between gap-3 rounded-md border border-edge bg-zinc-900/60 px-3 py-2"
            data-test="skill-row"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-ink">{{ skill.name }}</span>
                <Badge variant="info">{{ KIND_LABELS[skill.kind] }}</Badge>
              </div>
              <p class="mt-0.5 truncate text-xs text-ink-muted">
                {{ skill.description || (skill.template || skill.markdown || '').slice(0, 60) }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Switch
                v-if="isToggleable(skill)"
                :model-value="skill.enabled"
                data-test="skill-toggle"
                @update:model-value="onToggle(skill)"
              />
              <span v-else-if="skill.kind === 'project-tool'" class="text-xs text-ink-muted">
                项目工具
              </span>
              <span v-else class="text-xs text-ink-muted">随工作流模板</span>
              <Button
                v-if="isDeletable(skill)"
                size="sm"
                variant="ghost"
                data-test="skill-delete"
                @click="onDelete(skill)"
              >
                删除
              </Button>
            </div>
          </li>
        </ul>
      </section>

      <section class="rounded-lg border border-edge bg-zinc-900/40 p-4">
        <h3 class="text-sm font-semibold text-ink">安装技能</h3>
        <p class="mt-1 text-xs leading-relaxed text-ink-muted">
          粘贴提示词模板或 SKILL.md 风格技能说明，保存后即加入技能列表并注入 Agent
          上下文。ComfyUI 工作流技能无需安装，来自已保存的工作流模板。
        </p>

        <div class="mt-3 grid grid-cols-1 gap-4">
          <div class="flex flex-col gap-2">
            <span class="text-xs text-ink-muted">提示词模板</span>
            <Input v-model="installName" placeholder="技能名称" data-test="skill-install-name" />
            <Textarea
              v-model="installTemplate"
              :rows="3"
              :placeholder="'模板内容，可用 {{占位符}}'"
              data-test="skill-install-template"
            />
            <Button size="sm" data-test="skill-install-prompt" @click="installPromptTemplate">
              保存模板
            </Button>
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-xs text-ink-muted">SKILL.md</span>
            <Input
              v-model="installMdName"
              placeholder="技能名称"
              data-test="skill-install-md-name"
            />
            <Textarea
              v-model="installMarkdown"
              :rows="3"
              :placeholder="'# 技能名\n技能说明（markdown）'"
              data-test="skill-install-md-markdown"
            />
            <Button size="sm" data-test="skill-install-md" @click="installSkillMarkdown">
              保存技能
            </Button>
          </div>
        </div>

        <p
          v-if="installMessage"
          class="mt-3 text-xs"
          :class="installMessage.kind === 'error' ? 'text-red-400' : 'text-emerald-400'"
          data-test="skill-install-message"
        >
          {{ installMessage.text }}
        </p>
      </section>
    </div>
  </Dialog>
</template>
