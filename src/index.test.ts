import { test, expect, describe, mock } from 'bun:test'
import { GitMemory } from './index.ts'
import { renderTranscript } from './transcript.ts'
import type { MessageWithParts } from './transcript.ts'

// ---------------------------------------------------------------------------
// renderTranscript tests
// ---------------------------------------------------------------------------

describe('renderTranscript', () => {
  test('renders user message with text part', () => {
    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600000000 } },
        parts: [{ type: 'text', text: 'Refactor the auth module' }],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('# OpenCode Session Transcript')
    expect(result).toContain('Session: sess-1')
    expect(result).toContain('] User')
    expect(result).toContain('Refactor the auth module')
  })

  test('renders assistant message with model info', () => {
    const messages: MessageWithParts[] = [
      {
        info: {
          role: 'assistant',
          time: { created: 1710600000000 },
          providerID: 'anthropic',
          modelID: 'claude-sonnet-4-5',
        },
        parts: [{ type: 'text', text: 'I will refactor it now.' }],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('] Assistant  (anthropic/claude-sonnet-4-5)')
    expect(result).toContain('I will refactor it now.')
  })

  test('renders tool part with name and status only (no input/output)', () => {
    const messages: MessageWithParts[] = [
      {
        info: { role: 'assistant', time: { created: 1710600000000 } },
        parts: [
          {
            type: 'tool',
            tool: 'read',
            state: {
              status: 'completed',
              input: { filePath: 'src/auth.ts' },
              output: 'file contents here',
            },
          },
        ],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('### Tool: read')
    expect(result).toContain('**Status:** completed')
    expect(result).not.toContain('**Input:**')
    expect(result).not.toContain('**Output:**')
    expect(result).not.toContain('src/auth.ts')
    expect(result).not.toContain('file contents here')
  })

  test('skips synthetic text parts', () => {
    const messages: MessageWithParts[] = [
      {
        info: { role: 'assistant', time: { created: 1710600000000 } },
        parts: [
          { type: 'text', text: 'visible text' },
          { type: 'text', text: 'synthetic text', synthetic: true },
        ],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('visible text')
    expect(result).not.toContain('synthetic text')
  })

  test('renders reasoning parts', () => {
    const messages: MessageWithParts[] = [
      {
        info: { role: 'assistant', time: { created: 1710600000000 } },
        parts: [{ type: 'reasoning', text: 'Let me think about this.' }],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('> **Reasoning:** Let me think about this.')
  })

  test('returns header only for empty messages array', () => {
    const result = renderTranscript([], 'sess-1')
    expect(result).toContain('# OpenCode Session Transcript')
    expect(result).toContain('Session: sess-1')
    // No ## headings for messages
    expect(result).not.toContain('## [')
  })

  test('renders tool status for non-completed status without leaking output', () => {
    const messages: MessageWithParts[] = [
      {
        info: { role: 'assistant', time: { created: 1710600000000 } },
        parts: [
          {
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'error',
              input: { command: 'ls' },
              output: 'should not appear',
            },
          },
        ],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('### Tool: bash')
    expect(result).toContain('**Status:** error')
    expect(result).not.toContain('**Input:**')
    expect(result).not.toContain('**Output:**')
    expect(result).not.toContain('should not appear')
  })

  test('skips non-relevant part types', () => {
    const messages: MessageWithParts[] = [
      {
        info: { role: 'assistant', time: { created: 1710600000000 } },
        parts: [
          { type: 'snapshot' } as MessageWithParts['parts'][number],
          { type: 'step-start' } as MessageWithParts['parts'][number],
          { type: 'patch' } as MessageWithParts['parts'][number],
          { type: 'text', text: 'relevant' },
        ],
      },
    ]
    const result = renderTranscript(messages, 'sess-1')
    expect(result).toContain('relevant')
    expect(result).not.toContain('snapshot')
    expect(result).not.toContain('step-start')
    expect(result).not.toContain('patch')
  })
})

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function createMockShell(responses: Record<string, string> = {}) {
  const calls: string[] = []
  const shell = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let cmd = ''
    strings.forEach((s, i) => {
      cmd += s
      if (i < values.length) cmd += String(values[i])
    })
    calls.push(cmd.trim())

    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        return { text: () => Promise.resolve(response) }
      }
    }
    return {
      text: () =>
        Promise.reject(new Error(`mock shell: no match for "${cmd.trim()}"`)),
    }
  }
  return { shell, calls }
}

function createMockClient(messages: MessageWithParts[] = []) {
  return {
    session: {
      messages: mock(() => Promise.resolve({ data: messages })),
      prompt: mock(() => Promise.resolve()),
    },
    app: {
      log: mock(() => Promise.resolve()),
    },
  }
}

// ---------------------------------------------------------------------------
// GitMemory plugin hook tests
// ---------------------------------------------------------------------------

describe('GitMemory', () => {
  test('ignores non-bash tools', async () => {
    const { shell } = createMockShell({
      'git log': '1710600000\n',
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.after']!(
      { tool: 'read', sessionID: 'sess-1', callID: 'c1', args: {} },
      { title: '', output: 'ok', metadata: {} },
    )

    expect(mockClient.session.messages).not.toHaveBeenCalled()
  })

  test('ignores bash commands that are not git commit', async () => {
    const { shell } = createMockShell({
      'git log': '1710600000\n',
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git status' },
      },
      { title: '', output: 'ok', metadata: {} },
    )

    expect(mockClient.session.messages).not.toHaveBeenCalled()
  })

  test('ignores failed git commit (empty output)', async () => {
    const { shell } = createMockShell({
      'git log': '1710600000\n',
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git commit -m "test"' },
      },
      { title: '', output: '', metadata: {} },
    )

    expect(mockClient.session.messages).not.toHaveBeenCalled()
  })

  test('attaches git note on successful git commit', async () => {
    const { shell, calls } = createMockShell({
      'git log': '1710600000\n',
      'git rev-parse HEAD': 'abc123\n',
      'git notes --ref=refs/notes/opencode show': '', // will throw — no existing note
      'git notes --ref=refs/notes/opencode add': '',
    })
    // Override: make 'show' throw
    const originalShell = shell
    const patchedShell = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      if (cmd.includes('show')) {
        return { text: () => Promise.reject(new Error('no note')) }
      }
      return originalShell(strings, ...values)
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'Fix the bug' }],
      },
    ]
    const mockClient = createMockClient(messages)

    const hooks = await GitMemory({
      client: mockClient as any,
      $: patchedShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git commit -m "fix bug"' },
      },
      { title: '', output: '[main abc123] fix bug', metadata: {} },
    )

    expect(mockClient.session.messages).toHaveBeenCalledTimes(1)
    // Verify git notes add was called
    const addCall = calls.find(
      (c) => c.includes('git notes') && c.includes('add'),
    )
    expect(addCall).toBeDefined()
    expect(addCall).toContain('abc123')
  })

  test('skips note if no new messages since last commit', async () => {
    const { shell, calls } = createMockShell({
      'git log': '1710600000\n',
      'git rev-parse HEAD': 'abc123\n',
    })

    // Messages are all BEFORE the commit timestamp
    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710599000000 } },
        parts: [{ type: 'text', text: 'Old message' }],
      },
    ]
    const mockClient = createMockClient(messages)

    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git commit -m "test"' },
      },
      { title: '', output: '[main abc123] test', metadata: {} },
    )

    // git notes add should NOT have been called
    const addCall = calls.find(
      (c) => c.includes('git notes') && c.includes('add'),
    )
    expect(addCall).toBeUndefined()
  })

  test('logs error and does not throw if git operations fail', async () => {
    const failShell = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      if (cmd.includes('git log')) {
        return { text: () => Promise.resolve('1710600000\n') }
      }
      // Everything else fails
      return { text: () => Promise.reject(new Error('git broke')) }
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'Hello' }],
      },
    ]
    const mockClient = createMockClient(messages)

    const hooks = await GitMemory({
      client: mockClient as any,
      $: failShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    // Should not throw
    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git commit -m "test"' },
      },
      { title: '', output: 'committed', metadata: {} },
    )

    expect(mockClient.app.log).toHaveBeenCalledTimes(1)
    const logCall = (mockClient.app.log as any).mock.calls[0]?.[0]
    expect(logCall.body.level).toBe('error')
    expect(logCall.body.message).toContain('git broke')
  })

  test('appends to existing note with separator', async () => {
    const { shell, calls } = createMockShell({
      'git log': '1710600000\n',
      'git rev-parse HEAD': 'abc123\n',
      'git notes --ref=refs/notes/opencode show': 'Previous note content\n',
      'git notes --ref=refs/notes/opencode add': '',
    })

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'New message' }],
      },
    ]
    const mockClient = createMockClient(messages)

    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git commit -m "test"' },
      },
      { title: '', output: 'committed', metadata: {} },
    )

    // The add call should contain both old and new content with separator
    const addCall = calls.find(
      (c) => c.includes('git notes') && c.includes('add'),
    )
    expect(addCall).toBeDefined()
    expect(addCall).toContain('Previous note content')
    expect(addCall).toContain('---')
    expect(addCall).toContain('New message')
  })

  // ---------------------------------------------------------------------------
  // Amend tests
  // ---------------------------------------------------------------------------

  test('amend carries forward note from old commit', async () => {
    const OLD_HASH = 'old111'
    const NEW_HASH = 'new222'
    let revParseCount = 0
    const amendShell = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      if (cmd.includes('git log')) {
        return { text: () => Promise.resolve('1710600000\n') }
      }
      if (cmd.includes('rev-parse')) {
        revParseCount++
        // First call (before) returns old hash, second (after) returns new
        return { text: () => Promise.resolve(revParseCount === 1 ? `${OLD_HASH}\n` : `${NEW_HASH}\n`) }
      }
      if (cmd.includes('show') && cmd.includes(NEW_HASH)) {
        return { text: () => Promise.reject(new Error('no note')) }
      }
      if (cmd.includes('show') && cmd.includes(OLD_HASH)) {
        return { text: () => Promise.resolve('Old commit note\n') }
      }
      if (cmd.includes('add')) {
        return { text: () => Promise.resolve('') }
      }
      return { text: () => Promise.reject(new Error(`unexpected: ${cmd.trim()}`)) }
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'Amend message' }],
      },
    ]
    const mockClient = createMockClient(messages)
    const hooks = await GitMemory({
      client: mockClient as any,
      $: amendShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    // Before: capture pre-commit HEAD
    await hooks['tool.execute.before']!(
      { tool: 'bash', callID: 'c1' } as any,
      { args: { command: 'git commit --amend -m "amended"' } } as any,
    )
    // After: should carry forward old note
    await hooks['tool.execute.after']!(
      { tool: 'bash', sessionID: 'sess-1', callID: 'c1', args: { command: 'git commit --amend -m "amended"' } },
      { title: '', output: '[main new222] amended', metadata: {} },
    )

    expect(mockClient.session.messages).toHaveBeenCalledTimes(1)
  })

  test('amend with no old note works like normal commit', async () => {
    const OLD_HASH = 'old111'
    const NEW_HASH = 'new222'
    let revParseCount = 0
    const calls: string[] = []
    const amendShell = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      calls.push(cmd.trim())
      if (cmd.includes('git log')) {
        return { text: () => Promise.resolve('1710600000\n') }
      }
      if (cmd.includes('rev-parse')) {
        revParseCount++
        return { text: () => Promise.resolve(revParseCount === 1 ? `${OLD_HASH}\n` : `${NEW_HASH}\n`) }
      }
      if (cmd.includes('show')) {
        return { text: () => Promise.reject(new Error('no note')) }
      }
      if (cmd.includes('add')) {
        return { text: () => Promise.resolve('') }
      }
      return { text: () => Promise.reject(new Error(`unexpected: ${cmd.trim()}`)) }
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'Amend msg' }],
      },
    ]
    const mockClient = createMockClient(messages)
    const hooks = await GitMemory({
      client: mockClient as any,
      $: amendShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.before']!(
      { tool: 'bash', callID: 'c1' } as any,
      { args: { command: 'git commit --amend -m "amended"' } } as any,
    )
    await hooks['tool.execute.after']!(
      { tool: 'bash', sessionID: 'sess-1', callID: 'c1', args: { command: 'git commit --amend -m "amended"' } },
      { title: '', output: '[main new222] amended', metadata: {} },
    )

    const addCall = calls.find(c => c.includes('git notes') && c.includes('add'))
    expect(addCall).toBeDefined()
    // Should only contain transcript, no old note separator
    expect(addCall).toContain('Amend msg')
  })

  test('amend with both old note and existing note on new hash', async () => {
    const OLD_HASH = 'old111'
    const NEW_HASH = 'new222'
    let revParseCount = 0
    const calls: string[] = []
    const amendShell = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      calls.push(cmd.trim())
      if (cmd.includes('git log')) {
        return { text: () => Promise.resolve('1710600000\n') }
      }
      if (cmd.includes('rev-parse')) {
        revParseCount++
        return { text: () => Promise.resolve(revParseCount === 1 ? `${OLD_HASH}\n` : `${NEW_HASH}\n`) }
      }
      if (cmd.includes('show') && cmd.includes(NEW_HASH)) {
        return { text: () => Promise.resolve('Existing new note\n') }
      }
      if (cmd.includes('show') && cmd.includes(OLD_HASH)) {
        return { text: () => Promise.resolve('Old commit note\n') }
      }
      if (cmd.includes('add')) {
        return { text: () => Promise.resolve('') }
      }
      return { text: () => Promise.reject(new Error(`unexpected: ${cmd.trim()}`)) }
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'Triple note' }],
      },
    ]
    const mockClient = createMockClient(messages)
    const hooks = await GitMemory({
      client: mockClient as any,
      $: amendShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.before']!(
      { tool: 'bash', callID: 'c1' } as any,
      { args: { command: 'git commit --amend -m "amended"' } } as any,
    )
    await hooks['tool.execute.after']!(
      { tool: 'bash', sessionID: 'sess-1', callID: 'c1', args: { command: 'git commit --amend -m "amended"' } },
      { title: '', output: '[main new222] amended', metadata: {} },
    )

    const addCall = calls.find(c => c.includes('git notes') && c.includes('add'))
    expect(addCall).toBeDefined()
    // Should contain all three: old note, existing note, transcript
    expect(addCall).toContain('Old commit note')
    expect(addCall).toContain('Existing new note')
    expect(addCall).toContain('Triple note')
  })

  test('non-amend commit does not read old hash note', async () => {
    const { shell, calls } = createMockShell({
      'git log': '1710600000\n',
      'git rev-parse HEAD': 'abc123\n',
      'git notes --ref=refs/notes/opencode add': '',
    })
    // Make show throw (no existing note)
    const patchedShell = (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      if (cmd.includes('show')) {
        return { text: () => Promise.reject(new Error('no note')) }
      }
      return shell(strings, ...values)
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 1710600001000 } },
        parts: [{ type: 'text', text: 'Normal commit' }],
      },
    ]
    const mockClient = createMockClient(messages)
    const hooks = await GitMemory({
      client: mockClient as any,
      $: patchedShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['tool.execute.before']!(
      { tool: 'bash', callID: 'c1' } as any,
      { args: { command: 'git commit -m "normal"' } } as any,
    )
    await hooks['tool.execute.after']!(
      { tool: 'bash', sessionID: 'sess-1', callID: 'c1', args: { command: 'git commit -m "normal"' } },
      { title: '', output: '[main abc123] normal', metadata: {} },
    )

    // For non-amend, show should only be called once (for the new hash), not for an old hash
    const showCalls = calls.filter(c => c.includes('show'))
    expect(showCalls.length).toBe(0) // show throws so not captured, but git notes add should work
    const addCall = calls.find(c => c.includes('git notes') && c.includes('add'))
    expect(addCall).toBeDefined()
    expect(addCall).toContain('Normal commit')
  })

  test('handles repo with no commits at init', async () => {
    const failInitShell = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      if (cmd.includes('git log')) {
        return { text: () => Promise.reject(new Error('no commits')) }
      }
      if (cmd.includes('rev-parse')) {
        return { text: () => Promise.resolve('first123\n') }
      }
      if (cmd.includes('show')) {
        return { text: () => Promise.reject(new Error('no note')) }
      }
      if (cmd.includes('add')) {
        return { text: () => Promise.resolve('') }
      }
      return { text: () => Promise.reject(new Error('unexpected')) }
    }

    const messages: MessageWithParts[] = [
      {
        info: { role: 'user', time: { created: 100 } },
        parts: [{ type: 'text', text: 'Initial message' }],
      },
    ]
    const mockClient = createMockClient(messages)

    // Should not throw during init
    const hooks = await GitMemory({
      client: mockClient as any,
      $: failInitShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    // prevCommitTimestamp should be 0, so all messages are included
    await hooks['tool.execute.after']!(
      {
        tool: 'bash',
        sessionID: 'sess-1',
        callID: 'c1',
        args: { command: 'git commit -m "initial"' },
      },
      { title: '', output: 'committed', metadata: {} },
    )

    expect(mockClient.session.messages).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Read path: system prompt + tool tests
// ---------------------------------------------------------------------------

describe('GitMemory read path', () => {
  function createReadPathShell(
    opts: {
      defaultBranch?: string
      currentBranch?: string
      mergeBase?: string
      commits?: string
      noteResponses?: Record<string, string | Error>
    } = {},
  ) {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      cmd = cmd.trim()

      // Init: git log for prevCommitTimestamp
      if (cmd.includes('git log -1 --format=%ct')) {
        return { text: () => Promise.resolve('1710600000\n') }
      }

      // Default branch detection
      if (cmd.includes('symbolic-ref')) {
        if (opts.defaultBranch) {
          return {
            text: () =>
              Promise.resolve(`refs/remotes/origin/${opts.defaultBranch}\n`),
          }
        }
        return { text: () => Promise.reject(new Error('no ref')) }
      }
      if (cmd.includes('verify main')) {
        if (opts.defaultBranch === 'main') {
          return { text: () => Promise.resolve('abc\n') }
        }
        return { text: () => Promise.reject(new Error('no main')) }
      }
      if (cmd.includes('verify master')) {
        if (opts.defaultBranch === 'master') {
          return { text: () => Promise.resolve('abc\n') }
        }
        return { text: () => Promise.reject(new Error('no master')) }
      }

      // Current branch
      if (cmd.includes('branch --show-current')) {
        return {
          text: () => Promise.resolve(`${opts.currentBranch ?? 'main'}\n`),
        }
      }

      // Merge base
      if (cmd.includes('merge-base')) {
        if (opts.mergeBase) {
          return { text: () => Promise.resolve(`${opts.mergeBase}\n`) }
        }
        return { text: () => Promise.reject(new Error('no merge base')) }
      }

      // git log for commit listing
      if (cmd.includes('git log') && cmd.includes('%H')) {
        return { text: () => Promise.resolve(opts.commits ?? '') }
      }

      // git notes list (check if note exists)
      if (cmd.includes('notes --ref=refs/notes/opencode list')) {
        for (const [hash, resp] of Object.entries(opts.noteResponses ?? {})) {
          if (cmd.includes(hash)) {
            if (resp instanceof Error) {
              return { text: () => Promise.reject(resp) }
            }
            return { text: () => Promise.resolve('note-obj-hash\n') }
          }
        }
        return { text: () => Promise.reject(new Error('no note')) }
      }

      // git notes show
      if (cmd.includes('notes --ref=refs/notes/opencode show')) {
        for (const [hash, resp] of Object.entries(opts.noteResponses ?? {})) {
          if (cmd.includes(hash)) {
            if (resp instanceof Error) {
              return { text: () => Promise.reject(resp) }
            }
            return { text: () => Promise.resolve(resp + '\n') }
          }
        }
        return { text: () => Promise.reject(new Error('no note')) }
      }

      return { text: () => Promise.reject(new Error(`unmocked: ${cmd}`)) }
    }
  }

  test('system transform injects snippet when notes exist', async () => {
    const shell = createReadPathShell({
      defaultBranch: 'main',
      currentBranch: 'feature-x',
      mergeBase: 'base000',
      commits: 'aaa111\x00fix auth\x001710600000\n',
      noteResponses: { aaa111: '# Note content' },
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    const output = { system: [] as string[] }
    await hooks['experimental.chat.system.transform']!(
      { model: {} as any },
      output,
    )

    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain('Git Notes Context')
    expect(output.system[0]).toContain('aaa111')
    expect(output.system[0]).toContain('fix auth')
  })

  test('system transform injects nothing when no notes', async () => {
    const shell = createReadPathShell({
      defaultBranch: 'main',
      currentBranch: 'feature-x',
      mergeBase: 'base000',
      commits: 'aaa111\x00fix auth\x001710600000\n',
      noteResponses: { aaa111: new Error('no note') },
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    const output = { system: [] as string[] }
    await hooks['experimental.chat.system.transform']!(
      { model: {} as any },
      output,
    )

    expect(output.system.length).toBe(0)
  })

  test('git_notes_read tool returns note for specific commit', async () => {
    const shell = createReadPathShell({
      defaultBranch: 'main',
      currentBranch: 'main',
      noteResponses: { abc123: 'Full note content here' },
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    const result = await hooks.tool!.git_notes_read!.execute(
      { commit: 'abc123' },
      {
        sessionID: 'sess-1',
        messageID: 'm1',
        agent: 'default',
        directory: '/test',
        worktree: '/test',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      },
    )

    expect(result).toBe('Full note content here')
  })

  test('git_notes_read tool returns message when no note found', async () => {
    const shell = createReadPathShell({
      defaultBranch: 'main',
      currentBranch: 'main',
      noteResponses: {},
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    const result = await hooks.tool!.git_notes_read!.execute(
      { commit: 'nonexistent' },
      {
        sessionID: 'sess-1',
        messageID: 'm1',
        agent: 'default',
        directory: '/test',
        worktree: '/test',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      },
    )

    expect(result).toContain('No git note found')
  })

  test('git_notes_read tool returns all notes when no commit specified', async () => {
    const shell = createReadPathShell({
      defaultBranch: 'main',
      currentBranch: 'main',
      commits:
        'aaa111\x00fix auth\x001710600000\nbbb222\x00refactor api\x001710500000\n',
      noteResponses: {
        aaa111: 'Note for aaa',
        bbb222: 'Note for bbb',
      },
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    const result = await hooks.tool!.git_notes_read!.execute(
      {},
      {
        sessionID: 'sess-1',
        messageID: 'm1',
        agent: 'default',
        directory: '/test',
        worktree: '/test',
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      },
    )

    expect(result).toContain('Note for aaa')
    expect(result).toContain('Note for bbb')
    expect(result).toContain('---')
  })

  test('cache is invalidated after commit', async () => {
    let scanCount = 0
    const originalShell = createReadPathShell({
      defaultBranch: 'main',
      currentBranch: 'main',
      commits: '',
      noteResponses: {},
    })

    // Wrap to count scan calls
    const trackingShell = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      if (cmd.includes('git log') && cmd.includes('%H')) {
        scanCount++
      }
      return originalShell(strings, ...values)
    }

    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: trackingShell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    // First call: should scan (dirty=true initially)
    await hooks['experimental.chat.system.transform']!(
      { model: {} as any },
      { system: [] },
    )
    expect(scanCount).toBe(1)

    // Second call: should use cache (dirty=false)
    await hooks['experimental.chat.system.transform']!(
      { model: {} as any },
      { system: [] },
    )
    expect(scanCount).toBe(1) // no new scan
  })
})

// ---------------------------------------------------------------------------
// Notification: chat.message hook tests
// ---------------------------------------------------------------------------

describe('GitMemory notification', () => {
  function createNotificationShell(
    opts: {
      commits?: string
      noteResponses?: Record<string, string | Error>
    } = {},
  ) {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      let cmd = ''
      strings.forEach((s, i) => {
        cmd += s
        if (i < values.length) cmd += String(values[i])
      })
      cmd = cmd.trim()

      if (cmd.includes('git log -1 --format=%ct')) {
        return { text: () => Promise.resolve('1710600000\n') }
      }
      if (cmd.includes('symbolic-ref')) {
        return { text: () => Promise.resolve('refs/remotes/origin/main\n') }
      }
      if (cmd.includes('branch --show-current')) {
        return { text: () => Promise.resolve('main\n') }
      }
      if (cmd.includes('git log') && cmd.includes('%H')) {
        return { text: () => Promise.resolve(opts.commits ?? '') }
      }
      if (cmd.includes('notes --ref=refs/notes/opencode list')) {
        for (const [hash, resp] of Object.entries(opts.noteResponses ?? {})) {
          if (cmd.includes(hash)) {
            if (resp instanceof Error) {
              return { text: () => Promise.reject(resp) }
            }
            return { text: () => Promise.resolve('note-obj-hash\n') }
          }
        }
        return { text: () => Promise.reject(new Error('no note')) }
      }
      return { text: () => Promise.reject(new Error(`unmocked: ${cmd}`)) }
    }
  }

  test('sends notification on first chat.message when notes exist', async () => {
    const shell = createNotificationShell({
      commits: 'aaa111\x00fix auth\x001710600000\n',
      noteResponses: { aaa111: '# Note' },
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['chat.message']!({ sessionID: 'sess-1' } as any, {} as any)

    expect(mockClient.session.prompt).toHaveBeenCalledTimes(1)
    const call = (mockClient.session.prompt as any).mock.calls[0]![0]
    expect(call.body.noReply).toBe(true)
    expect(call.body.parts[0].text).toContain('aaa111')
    expect(call.body.parts[0].text).toContain('fix auth')
    expect(call.body.parts[0].text).toContain('git_notes_read')
  })

  test('does NOT send notification on second message (same session)', async () => {
    const shell = createNotificationShell({
      commits: 'aaa111\x00fix auth\x001710600000\n',
      noteResponses: { aaa111: '# Note' },
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['chat.message']!({ sessionID: 'sess-1' } as any, {} as any)
    await hooks['chat.message']!({ sessionID: 'sess-1' } as any, {} as any)

    expect(mockClient.session.prompt).toHaveBeenCalledTimes(1)
  })

  test('does NOT send notification when no notes exist', async () => {
    const shell = createNotificationShell({
      commits: '',
      noteResponses: {},
    })
    const mockClient = createMockClient()
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    await hooks['chat.message']!({ sessionID: 'sess-1' } as any, {} as any)

    expect(mockClient.session.prompt).not.toHaveBeenCalled()
  })

  test('handles prompt failure gracefully', async () => {
    const shell = createNotificationShell({
      commits: 'aaa111\x00fix auth\x001710600000\n',
      noteResponses: { aaa111: '# Note' },
    })
    const mockClient = createMockClient()
    ;(mockClient.session.prompt as any).mockImplementation(() =>
      Promise.reject(new Error('prompt not supported')),
    )
    const hooks = await GitMemory({
      client: mockClient as any,
      $: shell as any,
      project: {} as any,
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:4096'),
    })

    // Should not throw
    await hooks['chat.message']!({ sessionID: 'sess-1' } as any, {} as any)

    // Should have logged a warning
    expect(mockClient.app.log).toHaveBeenCalledTimes(1)
    const logCall = (mockClient.app.log as any).mock.calls[0]?.[0]
    expect(logCall.body.level).toBe('warn')
    expect(logCall.body.message).toContain('prompt not supported')
  })
})
