function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export interface MessageWithParts {
  info: { role: string; time: { created: number }; modelID?: string; providerID?: string }
  parts: Array<{
    type: string
    text?: string
    synthetic?: boolean
    tool?: string
    state?: {
      status: string
      input?: Record<string, unknown>
      output?: string
    }
  }>
}

export function renderTranscript(
  messages: MessageWithParts[],
  sessionID: string,
): string {
  const lines: string[] = [
    `# OpenCode Session Transcript`,
    `Session: ${sessionID}`,
    `Recorded: ${formatTime(Date.now())}`,
    '',
  ]

  for (const { info, parts } of messages) {
    const ts = formatTimestamp(info.time.created)
    const role = info.role === 'user' ? 'User' : 'Assistant'
    const model = info.role === 'assistant' && info.providerID && info.modelID
      ? `  (${info.providerID}/${info.modelID})`
      : ''
    lines.push(`## [${ts}] ${role}${model}`)
    lines.push('')

    for (const part of parts) {
      if (part.type === 'text' && part.text && !part.synthetic) {
        lines.push(part.text)
        lines.push('')
      } else if (part.type === 'reasoning' && part.text) {
        lines.push(`> **Reasoning:** ${part.text}`)
        lines.push('')
      } else if (part.type === 'tool' && part.tool && part.state) {
        lines.push(`### Tool: ${part.tool}`)
        lines.push(`**Status:** ${part.state.status}`)
        lines.push('')
      }
    }
  }

  return lines.join('\n').trim()
}
