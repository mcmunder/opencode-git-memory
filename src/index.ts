import { tool } from '@opencode-ai/plugin'
import type { Plugin } from '@opencode-ai/plugin'
import { renderTranscript } from './transcript.ts'
import type { MessageWithParts } from './transcript.ts'
import {
  scanCommitsWithNotes,
  readNote,
  buildSystemPromptSnippet,
  buildNotificationText,
} from './notes-reader.ts'
import type { CommitInfo } from './notes-reader.ts'

const NOTES_REF = 'refs/notes/opencode'
const GIT_COMMIT_RE = /\bgit\s+commit\b/
const GIT_AMEND_RE = /--amend\b/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(client: any, level: string, message: string) {
  try {
    client.app.log({ body: { service: 'opencode-git-memory', level, message } })
  } catch {
    // best-effort
  }
}

export const GitMemory: Plugin = async ({ client, $ }) => {
  // Capture baseline: timestamp of HEAD when plugin starts
  let prevCommitTimestamp = 0
  try {
    const ts = (await $`git log -1 --format=%ct HEAD`.text()).trim()
    prevCommitTimestamp = Number(ts) * 1000
  } catch {
    // No commits yet or not a git repo — start from 0
  }

  // Store last bash command from tool.execute.before so we can check it in .after
  // (tool.execute.after input may not include args in older SDK versions)
  let lastBashCommand = ''

  // Capture HEAD before a commit so we can detect amends and carry forward old notes
  let lastPreCommitHash = ''

  // --- Read path: cached commit index for system prompt ---
  let cachedCommits: CommitInfo[] | null = null
  let dirty = true
  const notifiedSessions = new Set<string>()

  async function getCommits(): Promise<CommitInfo[]> {
    if (dirty || cachedCommits === null) {
      try {
        cachedCommits = await scanCommitsWithNotes($)
      } catch {
        cachedCommits = []
      }
      dirty = false
    }
    return cachedCommits
  }

  return {
    // --- Notification: visible message when git notes context is available ---
    'chat.message': async (input) => {
      const sessionID = (input as { sessionID?: string }).sessionID
      if (!sessionID || notifiedSessions.has(sessionID)) return
      notifiedSessions.add(sessionID)

      try {
        const commits = await getCommits()
        const text = buildNotificationText(commits)
        if (!text) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client.session.prompt as any)({
          path: { id: sessionID },
          body: {
            noReply: true,
            parts: [{ type: 'text', text }],
          },
        })
        log(client, 'info', `Sent git notes notification for session ${sessionID.slice(0, 8)}`)
      } catch (err) {
        log(client, 'warn', `Failed to send git notes notification: ${err instanceof Error ? err.message : String(err)}`)
      }
    },

    // --- Read path: system prompt injection ---
    'experimental.chat.system.transform': async (_input, output) => {
      try {
        const commits = await getCommits()
        const snippet = buildSystemPromptSnippet(commits)
        if (snippet) {
          output.system.push(snippet)
        }
      } catch {
        // best-effort, don't break the session
      }
    },

    // --- Read path: custom tool for full note retrieval ---
    tool: {
      git_notes_read: tool({
        description:
          'Read AI conversation history attached to git commits as notes. ' +
          'Returns the full conversation transcript for a specific commit, ' +
          'or all notes for commits since the branch point.',
        args: {
          commit: tool.schema
            .string()
            .optional()
            .describe(
              'Specific commit hash (full or short). If omitted, returns notes for all commits with notes since the branch point.',
            ),
        },
        execute: async (args) => {
          if (args.commit) {
            const note = await readNote($, args.commit)
            return note ?? `No git note found for commit ${args.commit}`
          }
          // Return all notes
          const commits = await getCommits()
          if (commits.length === 0) return 'No commits with git notes found.'
          const results: string[] = []
          for (const c of commits) {
            const note = await readNote($, c.hash)
            if (note) {
              results.push(`## ${c.hash.slice(0, 8)} — ${c.subject}\n\n${note}`)
            }
          }
          return results.length > 0
            ? results.join('\n\n---\n\n')
            : 'No commits with git notes found.'
        },
      }),
    },

    // --- Write path: capture bash args ---
    'tool.execute.before': async (input, output) => {
      if (input.tool === 'bash') {
        lastBashCommand = String(output.args?.command ?? '')
        // Capture HEAD before commit so we can detect amends
        if (GIT_COMMIT_RE.test(lastBashCommand)) {
          try {
            lastPreCommitHash = (await $`git rev-parse HEAD`.text()).trim()
          } catch {
            lastPreCommitHash = ''
          }
        }
      }
    },

    // --- Write path: attach note after git commit ---
    'tool.execute.after': async (input, output) => {
      if (input.tool !== 'bash') return

      // Use args from input if available (v1.2+), fall back to captured command
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cmd = String((input as any).args?.command ?? '') || lastBashCommand
      if (!GIT_COMMIT_RE.test(cmd)) return
      // Only proceed if tool succeeded
      if (!output.output) return

      const sessionID = input.sessionID

      try {
        // Get new HEAD
        const newHash = (await $`git rev-parse HEAD`.text()).trim()

        // Fetch session messages (v1 SDK path-style calling convention)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: unknown = await (client.session.messages as any)({ path: { id: sessionID } })

        // Handle both response shapes:
        // - responseStyle "data": response IS the array
        // - default: response = { data: array }
        let allMessages: MessageWithParts[]
        if (Array.isArray(response)) {
          allMessages = response
        } else if (
          response != null &&
          typeof response === 'object' &&
          'data' in response &&
          Array.isArray((response as { data: unknown }).data)
        ) {
          allMessages = (response as { data: MessageWithParts[] }).data
        } else {
          log(client, 'warn', `Unexpected messages response shape: ${typeof response} / keys=${response != null && typeof response === 'object' ? Object.keys(response).join(',') : 'n/a'}`)
          return
        }

        // Filter to messages since previous commit
        const newMessages = allMessages.filter(
          (m) => m.info.time.created > prevCommitTimestamp,
        )

        if (newMessages.length === 0) return

        const transcript = renderTranscript(newMessages, sessionID)

        // Read existing note on new hash (if any — e.g. multiple commits in one session)
        let existingNote = ''
        try {
          existingNote = (
            await $`git notes --ref=${NOTES_REF} show ${newHash}`.text()
          ).trim()
        } catch {
          // No existing note
        }

        // If this was an amend, carry forward the note from the old (replaced) commit
        let oldNote = ''
        if (
          GIT_AMEND_RE.test(cmd) &&
          lastPreCommitHash &&
          lastPreCommitHash !== newHash
        ) {
          try {
            oldNote = (
              await $`git notes --ref=${NOTES_REF} show ${lastPreCommitHash}`.text()
            ).trim()
          } catch {
            // No note on old commit
          }
        }

        const fullNote = [oldNote, existingNote, transcript]
          .filter(Boolean)
          .join('\n\n---\n\n')

        await $`git notes --ref=${NOTES_REF} add -f -m ${fullNote} ${newHash}`

        // Update threshold for next commit
        prevCommitTimestamp = Date.now()

        // Invalidate cache so system prompt picks up the new note
        dirty = true

        log(client, 'info', `Attached git note to ${newHash.slice(0, 8)}`)
      } catch (err) {
        log(client, 'error', `Failed to attach git note: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
      }
    },
  }
}
