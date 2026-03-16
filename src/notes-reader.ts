const NOTES_REF = 'refs/notes/opencode'
const DEFAULT_LIMIT = 10

export interface CommitInfo {
  hash: string
  subject: string
  authorDate: number // unix timestamp in ms
}

export interface BunShellLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (strings: TemplateStringsArray, ...values: any[]): { text(): Promise<string> }
}

/**
 * Detect the default branch name.
 * Tries: origin/HEAD symbolic-ref → verify main → verify master → null
 */
export async function detectDefaultBranch($: BunShellLike): Promise<string | null> {
  // Try symbolic-ref (works when remote is configured)
  try {
    const ref = (await $`git symbolic-ref refs/remotes/origin/HEAD`.text()).trim()
    // ref is like "refs/remotes/origin/main"
    const branch = ref.split('/').pop()
    if (branch) return branch
  } catch {
    // no remote or no symbolic ref
  }

  // Try main
  try {
    await $`git rev-parse --verify main`.text()
    return 'main'
  } catch {
    // no main branch
  }

  // Try master
  try {
    await $`git rev-parse --verify master`.text()
    return 'master'
  } catch {
    // no master branch
  }

  return null
}

/**
 * Find the merge-base between HEAD and the default branch.
 * Returns null if HEAD is on the default branch or detection fails.
 */
export async function findBranchPoint($: BunShellLike, defaultBranch: string): Promise<string | null> {
  try {
    const current = (await $`git branch --show-current`.text()).trim()
    if (current === defaultBranch) return null
  } catch {
    return null
  }

  try {
    const base = (await $`git merge-base HEAD ${defaultBranch}`.text()).trim()
    return base || null
  } catch {
    return null
  }
}

/**
 * List commits that have git notes attached.
 * If branchPoint is provided, lists commits in branchPoint..HEAD.
 * Otherwise, lists the last `limit` commits.
 */
export async function listCommitsWithNotes(
  $: BunShellLike,
  opts: { branchPoint?: string; limit?: number } = {},
): Promise<CommitInfo[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  let logOutput: string

  try {
    if (opts.branchPoint) {
      logOutput = (await $`git log --format=%H%x00%s%x00%at ${opts.branchPoint}..HEAD`.text()).trim()
    } else {
      logOutput = (await $`git log --format=%H%x00%s%x00%at -n ${String(limit)} HEAD`.text()).trim()
    }
  } catch {
    return []
  }

  if (!logOutput) return []

  const commits: CommitInfo[] = []
  for (const line of logOutput.split('\n')) {
    const parts = line.split('\0')
    if (parts.length < 3) continue
    const hash = parts[0]!
    const subject = parts[1]!
    const authorDate = Number(parts[2]!) * 1000

    // Check if this commit has a note
    try {
      await $`git notes --ref=${NOTES_REF} list ${hash}`.text()
      commits.push({ hash, subject, authorDate })
    } catch {
      // No note for this commit
    }
  }

  return commits
}

/**
 * Read the full note for a specific commit.
 */
export async function readNote($: BunShellLike, commitHash: string): Promise<string | null> {
  try {
    const note = (await $`git notes --ref=${NOTES_REF} show ${commitHash}`.text()).trim()
    return note || null
  } catch {
    return null
  }
}

/**
 * Build a system prompt snippet from commits with notes.
 */
export function buildSystemPromptSnippet(commits: CommitInfo[]): string | null {
  if (commits.length === 0) return null

  const lines = [
    '## Git Notes Context',
    '',
    'This repository has AI conversation history attached to the following commits as git notes (ref: refs/notes/opencode).',
    'You have access to the `git_notes_read` tool, which can retrieve full conversation context for any commit.',
    '',
    '| Commit | Subject |',
    '|--------|---------|',
  ]

  for (const c of commits) {
    lines.push(`| ${c.hash.slice(0, 8)} | ${c.subject} |`)
  }

  return lines.join('\n')
}

/**
 * Format a timestamp as a human-readable relative date.
 */
export function formatRelativeDate(timestampMs: number, now?: number): string {
  const diff = (now ?? Date.now()) - timestampMs
  if (diff < 0) return 'just now'

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`

  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`

  const years = Math.floor(days / 365)
  return years === 1 ? '1 year ago' : `${years} years ago`
}

/**
 * Build a visible notification message listing commits with notes.
 */
export function buildNotificationText(commits: CommitInfo[], now?: number): string | null {
  if (commits.length === 0) return null

  const lines = [
    `Found AI conversation history attached to ${commits.length} commit${commits.length === 1 ? '' : 's'}:`,
    '',
  ]

  for (const c of commits) {
    const rel = formatRelativeDate(c.authorDate, now)
    lines.push(`  - ${c.hash.slice(0, 8)} (${rel}) — ${c.subject}`)
  }

  lines.push('')
  lines.push('Your agent has access to the `git_notes_read` tool and can retrieve full conversation transcripts directly.')

  return lines.join('\n')
}

/**
 * High-level: scan for commits with notes since branch point (or last N).
 */
export async function scanCommitsWithNotes($: BunShellLike): Promise<CommitInfo[]> {
  const defaultBranch = await detectDefaultBranch($)

  let branchPoint: string | null = null
  if (defaultBranch) {
    branchPoint = await findBranchPoint($, defaultBranch)
  }

  return listCommitsWithNotes($, { branchPoint: branchPoint ?? undefined })
}
