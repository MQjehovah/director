import { describe, it, expect } from 'vitest'
import { parseToolCalls, formatToolCall, TOOL_MARKER_REGEX } from '../parser'

describe('parseToolCalls', () => {
  it('parses a single tool with a simple unicode arg', () => {
    const calls = parseToolCalls('[[tool:generate_script(idea=都市少年)]]')
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('generate_script')
    expect(calls[0].args).toEqual({ idea: '都市少年' })
    expect(calls[0].raw).toBe('[[tool:generate_script(idea=都市少年)]]')
  })

  it('parses quoted args with spaces, angle brackets and Chinese', () => {
    const calls = parseToolCalls('[[tool:expand_prompt(text=银发剑士, style="<anime>")]]')
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('expand_prompt')
    expect(calls[0].args).toEqual({ text: '银发剑士', style: '<anime>' })
  })

  it('parses single-quoted args', () => {
    const calls = parseToolCalls("[[tool:cut_scene(sceneId='sc-1')]]")
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ sceneId: 'sc-1' })
  })

  it('parses multiple markers mixed with prose', () => {
    const text =
      '先这样，再那样。[[tool:generate_script(idea=都市少年)]] 之后 [[tool:cut_scene(sceneId=sc-1)]]'
    const calls = parseToolCalls(text)
    expect(calls).toHaveLength(2)
    expect(calls[0].name).toBe('generate_script')
    expect(calls[0].raw).toBe('[[tool:generate_script(idea=都市少年)]]')
    expect(calls[1].name).toBe('cut_scene')
    expect(calls[1].args.sceneId).toBe('sc-1')
  })

  it('skips malformed markers but keeps valid ones', () => {
    const text = '[[tool:(no-name)]] [[tool:]] broken [[tool:foo(x=1)]] [[tool:foo(x=1)'
    const calls = parseToolCalls(text)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('foo')
    expect(calls[0].args).toEqual({ x: '1' })
  })

  it('handles empty args and bare values', () => {
    const calls = parseToolCalls('[[tool:ping()]] [[tool:foo(idea=都市少年与AI伙伴)]]')
    expect(calls[0].args).toEqual({})
    expect(calls[1].args.idea).toBe('都市少年与AI伙伴')
  })

  it('handles quotes inside unquoted and quoted values', () => {
    const calls = parseToolCalls('[[tool:foo(a=x"y)]] [[tool:bar(b="说\\"你好\\"")]]')
    expect(calls[0].args.a).toBe('x"y')
    expect(calls[1].args.b).toBe('说"你好"')
  })

  it('formatToolCall round-trips through the parser', () => {
    const name = 'expand_prompt'
    const args = { text: '银发剑士', style: '<anime>' }
    const calls = parseToolCalls(formatToolCall(name, args))
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe(name)
    expect(calls[0].args).toEqual(args)
  })

  it('formatToolCall quotes values containing special characters', () => {
    const marker = formatToolCall('expand_prompt', {
      text: '银发 剑士',
      style: 'portrait, cinematic',
    })
    expect(marker).toBe('[[tool:expand_prompt(text="银发 剑士", style="portrait, cinematic")]]')
  })

  it('formatToolCall leaves angle-bracket styles unquoted like the design doc idiom', () => {
    expect(formatToolCall('generate_portrait', { character: '小明', style: '<anime>' })).toBe(
      '[[tool:generate_portrait(character=小明, style=<anime>)]]',
    )
  })

  it('formatToolCall with no args emits an empty arg list', () => {
    expect(formatToolCall('ping', {})).toBe('[[tool:ping()]]')
  })

  it('TOOL_MARKER_REGEX matches a full marker', () => {
    const re = new RegExp(TOOL_MARKER_REGEX.source, 'g')
    expect(re.test('[[tool:foo(bar=1)]]')).toBe(true)
    expect(re.test('text without marker')).toBe(false)
  })
})
