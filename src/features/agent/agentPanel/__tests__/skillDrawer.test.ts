import { mount } from '@vue/test-utils'
import { DOMWrapper } from '@vue/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import SkillDrawer from '../SkillDrawer.vue'
import { listSkills, getSkill, saveSkill } from '../../skills/skillStore'

function inDialog(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector)
  if (!el) throw new Error(`dialog element not found: ${selector}`)
  return new DOMWrapper(el)
}

function rowByText(text: string): Element {
  const rows = document.body.querySelectorAll('[data-test="skill-row"]')
  const found = [...rows].find((r) => r.textContent?.includes(text))
  if (!found) throw new Error(`skill row not found: ${text}`)
  return found
}

describe('SkillDrawer', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('lists persisted skills and derived project-tool skills', async () => {
    mount(SkillDrawer, { props: { open: true } })
    await nextTick()
    const rows = document.body.querySelectorAll('[data-test="skill-row"]')
    expect(rows.length).toBe(12) // 5 built-ins + 7 project tools
    const rowTexts = [...rows].map((r) => r.textContent ?? '')
    expect(rowTexts.some((t) => t.includes('角色设定卡'))).toBe(true)
    expect(rowTexts.some((t) => t.includes('generate_script'))).toBe(true)
  })

  it('toggles a persisted skill and updates its enabled state', async () => {
    mount(SkillDrawer, { props: { open: true } })
    await nextTick()
    const row = rowByText('角色设定卡')
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(getSkill('role-card')?.enabled).toBe(true)
    checkbox.click()
    await nextTick()
    expect(getSkill('role-card')?.enabled).toBe(false)
    checkbox.click()
    await nextTick()
    expect(getSkill('role-card')?.enabled).toBe(true)
  })

  it('installs a custom prompt-template skill', async () => {
    mount(SkillDrawer, { props: { open: true } })
    await nextTick()
    await inDialog('[data-test="skill-install-name"]').setValue('我的模板')
    await inDialog('[data-test="skill-install-template"]').setValue('请生成：{{subject}}')
    await inDialog('[data-test="skill-install-prompt"]').trigger('click')
    await nextTick()
    expect(
      listSkills().some((s) => s.name === '我的模板' && s.kind === 'prompt-template'),
    ).toBe(true)
    expect(rowByText('我的模板')).toBeTruthy()
  })

  it('installs a custom SKILL.md skill', async () => {
    mount(SkillDrawer, { props: { open: true } })
    await nextTick()
    await inDialog('[data-test="skill-install-md-name"]').setValue('分镜大师')
    await inDialog('[data-test="skill-install-md-markdown"]').setValue('# 分镜大师\n\n一段分镜技巧说明')
    await inDialog('[data-test="skill-install-md"]').trigger('click')
    await nextTick()
    const installed = listSkills().find((s) => s.name === '分镜大师')
    expect(installed?.kind).toBe('skill-md')
    expect(installed?.markdown).toContain('分镜技巧')
  })

  it('deletes a custom skill but not a built-in', async () => {
    saveSkill({
      id: 'custom-md',
      name: '自定义技能',
      description: 'd',
      kind: 'skill-md',
      enabled: true,
      markdown: '# 自定义',
    })
    mount(SkillDrawer, { props: { open: true } })
    await nextTick()
    const customRow = rowByText('自定义技能')
    expect(customRow.querySelector('[data-test="skill-delete"]')).toBeTruthy()
    const builtinRow = rowByText('角色设定卡')
    expect(builtinRow.querySelector('[data-test="skill-delete"]')).toBeNull()
    ;(customRow.querySelector('[data-test="skill-delete"]') as HTMLButtonElement).click()
    await nextTick()
    expect(getSkill('custom-md')).toBeUndefined()
  })

  it('emits close from the dialog close button', async () => {
    const w = mount(SkillDrawer, { props: { open: true } })
    await nextTick()
    inDialog('[aria-label="关闭"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})
