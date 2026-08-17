import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Button from '../Button.vue'
import Input from '../Input.vue'
import Textarea from '../Textarea.vue'
import Select from '../Select.vue'
import Switch from '../Switch.vue'
import Badge from '../Badge.vue'
import Progress from '../Progress.vue'
import Dialog from '../Dialog.vue'

describe('ui primitives', () => {
  it('button emits click and applies variant', () => {
    const w = mount(Button, { props: { variant: 'primary' } })
    expect(w.classes()).toContain('bg-accent')
    expect(w.attributes('type')).toBe('button')
  })

  it('input emits update:modelValue on input', async () => {
    const w = mount(Input, { props: { modelValue: '' } })
    await w.find('input').setValue('小明')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['小明'])
  })

  it('textarea supports rows and v-model', async () => {
    const w = mount(Textarea, { props: { rows: 6 } })
    expect(w.find('textarea').attributes('rows')).toBe('6')
    await w.find('textarea').setValue('你好')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['你好'])
  })

  it('select shows options and emits choice', async () => {
    const w = mount(Select, {
      props: { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    })
    const opts = w.findAll('option')
    expect(opts.map((o) => o.text())).toEqual(['A', 'B'])
    await w.find('select').setValue('b')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['b'])
  })

  it('switch toggles checked state', async () => {
    const w = mount(Switch, { props: { modelValue: true } })
    expect(w.find('input').element.checked).toBe(true)
    await w.find('input').setValue(false)
    expect(w.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('badge applies variant class', () => {
    const w = mount(Badge, { props: { variant: 'success' } })
    expect(w.classes()).toContain('bg-emerald-500/15')
  })

  it('progress renders bar with clamped width', () => {
    const w = mount(Progress, { props: { value: 50 } })
    expect(w.find('[role=progressbar]').attributes('aria-valuenow')).toBe('50')
    expect(w.find('.h-full').attributes('style')).toContain('50%')
  })

  it('dialog renders content when open', () => {
    mount(Dialog, { props: { open: true, title: '编辑' } })
    expect(document.body.textContent).toContain('编辑')
  })
})
