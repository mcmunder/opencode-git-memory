# opencode-git-memory

An [OpenCode](https://opencode.ai) plugin that gives your AI agent memory that persists across sessions and travels with your code.

## Why This Plugin

AI conversations during coding sessions contain valuable context — decisions made, approaches considered, reasoning behind changes — that is normally lost when the session ends. The next time you (or the AI) revisit the same code, all of that context has to be rebuilt from scratch.

OpenCode stores session history locally on your machine, but this history isn't portable — collaborators working on the same branch have no visibility into the AI conversations that shaped the code. Git notes solve this: they live in the repository itself and can be pushed and fetched just like branches, making conversation context shareable across your team.

This plugin attaches conversation transcripts to git commits using [git notes](https://git-scm.com/docs/git-notes). When a new session starts, it automatically surfaces this historical context, giving the AI "memory" scoped to your branch and commit history.

## How It Works

### Write path — saving conversations

When a `git commit` is executed during an OpenCode session, the plugin:

1. Captures the conversation messages since the last commit
2. Renders them as a Markdown transcript (text, reasoning, and tool names only — no file paths or tool output for privacy)
3. Attaches the transcript to the new commit as a git note under `refs/notes/opencode`

If multiple commits happen in one session, each gets its own transcript appended with a separator.

> **Warning:** Git notes are stored in the repository and can be pushed to remotes. While the plugin strips tool input/output to reduce exposure, conversation text itself is captured. If secrets (API keys, passwords, tokens) appear in your conversation messages, they could end up in the notes. Avoid pasting secrets directly into the chat, and review notes before pushing with `git notes --ref=refs/notes/opencode show <commit>`.

### Read path — restoring context

When a new session starts, the plugin:

1. Scans the branch history for commits that have attached notes
2. Injects a summary of available notes into the AI's system prompt
3. Provides a `git_notes_read` tool that the agent can use directly to retrieve full conversation transcripts for any commit

### Notification

When a session opens and notes are available, a visible message lists the commits with attached conversation history, so you know context is available before you start working.

> **Important:** Commits must be made _within an OpenCode session_ for the plugin to capture conversations. The plugin hooks into OpenCode's tool execution pipeline — it detects when the AI agent runs `git commit` via the bash tool. Commits made in an external terminal or Git GUI will not have conversation history attached.

## Installation

Add the plugin to your OpenCode configuration in `.opencode/opencode.json`:

```json
{
  "plugin": ["@mcmunder/opencode-git-memory"]
}
```

## Working with Git Notes

Notes are stored under the custom ref `refs/notes/opencode`, separate from the default git notes ref.

**View a note:**

```sh
git notes --ref=refs/notes/opencode show <commit>
```

**Push notes to a remote** (to share context with your team):

```sh
git push origin refs/notes/opencode
```

**Fetch notes from a remote:**

```sh
git fetch origin refs/notes/opencode:refs/notes/opencode
```

## Development

```sh
bun install        # install dependencies
bun test           # run tests
bun run build      # build bundle + type declarations
```

To test the plugin end-to-end, create a temporary git repo and link the plugin:

```sh
mkdir -p /tmp/test-git-notes && cd /tmp/test-git-notes
git init
mkdir -p .opencode
```

Create `.opencode/opencode.json` pointing to your local build using a relative path:

```json
{
  "plugin": ["../../dist/index.js"]
}
```

Then run OpenCode from the test repo:

```sh
cd /tmp/test-git-notes
opencode
```

Any commits made through the OpenCode session will have conversation history attached as git notes. Verify with:

```sh
git notes --ref=refs/notes/opencode show HEAD
```

## License

MIT
