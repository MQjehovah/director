import type { AgentToolCall } from './types'

export const TOOL_MARKER_REGEX =
  /\[\[tool:([A-Za-z_][A-Za-z0-9_]*)\s*\(((?:[^()]|\([^()]*\))*)\)\]\]/g

export function parseToolCalls(text: string): AgentToolCall[] {
  const calls: AgentToolCall[] = []
  const re = new RegExp(TOOL_MARKER_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    calls.push({ name: match[1], args: parseArgs(match[2]), raw: match[0] })
  }
  return calls
}

function parseArgs(inner: string): Record<string, string> {
  const args: Record<string, string> = {}
  for (const segment of splitArgs(inner)) {
    const eq = segment.indexOf('=')
    if (eq <= 0) continue
    const key = segment.slice(0, eq).trim()
    if (!key) continue
    args[key] = unquoteValue(segment.slice(eq + 1).trim())
  }
  return args
}

function splitArgs(inner: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const ch of inner) {
    if (quote !== null) {
      current += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function unquoteValue(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).replace(/\\(["'\\])/g, '$1')
    }
  }
  return value
}

export function formatToolCall(name: string, args: Record<string, string>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return `[[tool:${name}()]]`
  const inner = entries
    .map(([key, value]) => {
      if (/[\s"'=,()]/.test(value)) {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        return `${key}="${escaped}"`
      }
      return `${key}=${value}`
    })
    .join(', ')
  return `[[tool:${name}(${inner})]]`
}
