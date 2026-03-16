import { test, expect, describe } from 'bun:test'
import {
  detectDefaultBranch,
  findBranchPoint,
  listCommitsWithNotes,
  readNote,
  buildSystemPromptSnippet,
  scanCommitsWithNotes,
  formatRelativeDate,
  buildNotificationText,
} from './notes-reader.ts'
import type { BunShellLike, CommitInfo } from './notes-reader.ts'

// Helper: build a mock shell from command→response map
function mockShell(responses: Record<string, string | Error>): BunShellLike {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let cmd = ''
    strings.forEach((s, i) => {
      cmd += s
      if (i < values.length) cmd += String(values[i])
    })
    cmd = cmd.trim()
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        if (response instanceof Error) {
          return { text: () => Promise.reject(response) }
        }
        return { text: () => Promise.resolve(response) }
      }
    }
    return { text: () => Promise.reject(new Error(`no mock for: ${cmd}`)) }
  }) as BunShellLike
}

// ---------------------------------------------------------------------------
// detectDefaultBranch
// ---------------------------------------------------------------------------

describe('detectDefaultBranch', () => {
  test('detects from symbolic-ref', async () => {
    const $ = mockShell({
      'symbolic-ref': 'refs/remotes/origin/main\n',
    })
    expect(await detectDefaultBranch($)).toBe('main')
  })

  test('falls back to verifying main', async () => {
    const $ = mockShell({
      'symbolic-ref': new Error('no ref'),
      'verify main': 'abc123\n',
    })
    expect(await detectDefaultBranch($)).toBe('main')
  })

  test('falls back to verifying master', async () => {
    const $ = mockShell({
      'symbolic-ref': new Error('no ref'),
      'verify main': new Error('no main'),
      'verify master': 'abc123\n',
    })
    expect(await detectDefaultBranch($)).toBe('master')
  })

  test('returns null when nothing found', async () => {
    const $ = mockShell({
      'symbolic-ref': new Error('no ref'),
      'verify main': new Error('no main'),
      'verify master': new Error('no master'),
    })
    expect(await detectDefaultBranch($)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findBranchPoint
// ---------------------------------------------------------------------------

describe('findBranchPoint', () => {
  test('finds merge-base when on feature branch', async () => {
    const $ = mockShell({
      'branch --show-current': 'feature-x\n',
      'merge-base': 'abc123\n',
    })
    expect(await findBranchPoint($, 'main')).toBe('abc123')
  })

  test('returns null when on default branch', async () => {
    const $ = mockShell({
      'branch --show-current': 'main\n',
    })
    expect(await findBranchPoint($, 'main')).toBeNull()
  })

  test('returns null when merge-base fails', async () => {
    const $ = mockShell({
      'branch --show-current': 'feature-x\n',
      'merge-base': new Error('no merge base'),
    })
    expect(await findBranchPoint($, 'main')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listCommitsWithNotes
// ---------------------------------------------------------------------------

describe('listCommitsWithNotes', () => {
  test('lists commits with notes since branch point', async () => {
    const $ = mockShell({
      'git log': 'aaa111\x00fix auth\x001710600000\nbbb222\x00refactor api\x001710500000\n',
      'notes --ref=refs/notes/opencode list aaa111': 'note-hash\n',
      'notes --ref=refs/notes/opencode list bbb222': new Error('no note'),
    })
    const result = await listCommitsWithNotes($, { branchPoint: 'base123' })
    expect(result).toEqual([{ hash: 'aaa111', subject: 'fix auth', authorDate: 1710600000000 }])
  })

  test('returns empty when no commits', async () => {
    const $ = mockShell({
      'git log': '',
    })
    expect(await listCommitsWithNotes($)).toEqual([])
  })

  test('returns empty when git log fails', async () => {
    const $ = mockShell({
      'git log': new Error('not a repo'),
    })
    expect(await listCommitsWithNotes($)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// readNote
// ---------------------------------------------------------------------------

describe('readNote', () => {
  test('reads existing note', async () => {
    const $ = mockShell({
      'show abc123': 'The note content\n',
    })
    expect(await readNote($, 'abc123')).toBe('The note content')
  })

  test('returns null for missing note', async () => {
    const $ = mockShell({
      'show abc123': new Error('no note'),
    })
    expect(await readNote($, 'abc123')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildSystemPromptSnippet
// ---------------------------------------------------------------------------

describe('buildSystemPromptSnippet', () => {
  test('builds markdown table', () => {
    const commits: CommitInfo[] = [
      { hash: 'aaa11111222233334444', subject: 'fix auth bug', authorDate: 1710600000000 },
      { hash: 'bbb11111222233334444', subject: 'refactor API', authorDate: 1710500000000 },
    ]
    const snippet = buildSystemPromptSnippet(commits)!
    expect(snippet).toContain('## Git Notes Context')
    expect(snippet).toContain('git_notes_read')
    expect(snippet).toContain('| aaa11111 | fix auth bug |')
    expect(snippet).toContain('| bbb11111 | refactor API |')
  })

  test('returns null for empty list', () => {
    expect(buildSystemPromptSnippet([])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// scanCommitsWithNotes (integration of detect + branch point + list)
// ---------------------------------------------------------------------------

describe('scanCommitsWithNotes', () => {
  test('scans from branch point on feature branch', async () => {
    const $ = mockShell({
      'symbolic-ref': 'refs/remotes/origin/main\n',
      'branch --show-current': 'feature-x\n',
      'merge-base': 'base000\n',
      'git log': 'ccc111\x00add feature\x001710600000\n',
      'notes --ref=refs/notes/opencode list ccc111': 'note-hash\n',
    })
    const result = await scanCommitsWithNotes($)
    expect(result).toEqual([{ hash: 'ccc111', subject: 'add feature', authorDate: 1710600000000 }])
  })

  test('falls back to last N commits on default branch', async () => {
    const $ = mockShell({
      'symbolic-ref': 'refs/remotes/origin/main\n',
      'branch --show-current': 'main\n',
      'git log': 'ddd111\x00latest commit\x001710600000\n',
      'notes --ref=refs/notes/opencode list ddd111': 'note-hash\n',
    })
    const result = await scanCommitsWithNotes($)
    expect(result).toEqual([{ hash: 'ddd111', subject: 'latest commit', authorDate: 1710600000000 }])
  })

  test('falls back to last N when no default branch detected', async () => {
    const $ = mockShell({
      'symbolic-ref': new Error('no ref'),
      'verify main': new Error('no main'),
      'verify master': new Error('no master'),
      'git log': 'eee111\x00some commit\x001710600000\n',
      'notes --ref=refs/notes/opencode list eee111': 'note-hash\n',
    })
    const result = await scanCommitsWithNotes($)
    expect(result).toEqual([{ hash: 'eee111', subject: 'some commit', authorDate: 1710600000000 }])
  })
})


// ---------------------------------------------------------------------------
// formatRelativeDate
// ---------------------------------------------------------------------------

describe('formatRelativeDate', () => {
  const NOW = 1710600000000

  test('returns "just now" for timestamps less than 60s ago', () => {
    expect(formatRelativeDate(NOW - 30_000, NOW)).toBe('just now')
  })

  test('returns "just now" for future timestamps', () => {
    expect(formatRelativeDate(NOW + 10_000, NOW)).toBe('just now')
  })

  test('returns minutes', () => {
    expect(formatRelativeDate(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago')
    expect(formatRelativeDate(NOW - 1 * 60_000, NOW)).toBe('1 minute ago')
  })

  test('returns hours', () => {
    expect(formatRelativeDate(NOW - 3 * 3600_000, NOW)).toBe('3 hours ago')
    expect(formatRelativeDate(NOW - 1 * 3600_000, NOW)).toBe('1 hour ago')
  })

  test('returns days', () => {
    expect(formatRelativeDate(NOW - 2 * 86400_000, NOW)).toBe('2 days ago')
    expect(formatRelativeDate(NOW - 1 * 86400_000, NOW)).toBe('1 day ago')
  })

  test('returns weeks', () => {
    expect(formatRelativeDate(NOW - 14 * 86400_000, NOW)).toBe('2 weeks ago')
    expect(formatRelativeDate(NOW - 7 * 86400_000, NOW)).toBe('1 week ago')
  })

  test('returns months', () => {
    expect(formatRelativeDate(NOW - 60 * 86400_000, NOW)).toBe('2 months ago')
  })

  test('returns years', () => {
    expect(formatRelativeDate(NOW - 400 * 86400_000, NOW)).toBe('1 year ago')
    expect(formatRelativeDate(NOW - 800 * 86400_000, NOW)).toBe('2 years ago')
  })
})

// ---------------------------------------------------------------------------
// buildNotificationText
// ---------------------------------------------------------------------------

describe('buildNotificationText', () => {
  const NOW = 1710600000000

  test('returns null for empty commits', () => {
    expect(buildNotificationText([], NOW)).toBeNull()
  })

  test('builds notification with relative dates', () => {
    const commits: CommitInfo[] = [
      { hash: 'aaa11111222233334444', subject: 'fix auth bug', authorDate: NOW - 3600_000 },
      { hash: 'bbb11111222233334444', subject: 'refactor API', authorDate: NOW - 2 * 86400_000 },
    ]
    const text = buildNotificationText(commits, NOW)!
    expect(text).toContain('2 commits')
    expect(text).toContain('aaa11111 (1 hour ago)')
    expect(text).toContain('fix auth bug')
    expect(text).toContain('bbb11111 (2 days ago)')
    expect(text).toContain('refactor API')
    expect(text).toContain('git_notes_read')
  })

  test('uses singular for one commit', () => {
    const commits: CommitInfo[] = [
      { hash: 'aaa11111222233334444', subject: 'fix bug', authorDate: NOW - 60_000 },
    ]
    const text = buildNotificationText(commits, NOW)!
    expect(text).toContain('1 commit')
    expect(text).not.toContain('1 commits')
  })
})
