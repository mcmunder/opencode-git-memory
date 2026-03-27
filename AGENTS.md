# AGENTS.md

This file provides guidance for agentic coding agents operating in this repository.

---

## Project Overview

An OpenCode plugin (`opencode-git-memory`) that automatically stores AI conversation history as git notes metadata on each commit. Built as a Bun-native TypeScript project — Bun is the runtime, package manager, and test runner. No Node.js, npm, pnpm, Jest, or Webpack.

### How it works

1. Hooks into OpenCode's `tool.execute.after` event
2. Detects successful `git commit` bash commands
3. Fetches session messages since the last commit
4. Renders them as a Markdown transcript (text, reasoning, and tool parts only)
5. Attaches the transcript to the new commit via `git notes --ref=refs/notes/opencode`

### Key design decisions

- **Append mode**: Multiple commits in one session concatenate notes with `---` separators
- **Custom git notes ref**: `refs/notes/opencode` (keeps notes separate from default ref)
- **Tool output hidden**: Tool parts record name and status only — no input/output to avoid leaking file paths
- **Session-scoped**: Only messages from the current session, since the previous commit
- **Noise filtering**: Skips `snapshot`, `patch`, `step-start`, `step-finish`, and `compaction` parts

---

## Project Structure

```
src/
├── index.ts              ← Plugin entry point (exports GitMemory)
├── index.test.ts         ← Plugin hook tests
├── transcript.ts         ← renderTranscript() + MessageWithParts type
├── notes-reader.ts       ← Git notes reading logic (branch detection, commit scanning, system prompt)
└── notes-reader.test.ts  ← Tests for notes reader functions
dist/                     ← Build output (gitignored, included in npm package)
tsconfig.json             ← Base config (noEmit, for type-checking)
tsconfig.build.json       ← Build config (emits .js + .d.ts to dist/)
package.json              ← npm package config
```

---

## Commands

### Install dependencies

```sh
bun install
```

### Build (emit JS + declarations to dist/)

```sh
bun run build
```

### Type-check (no emit)

```sh
bunx tsc --noEmit
```

### Run all tests

```sh
bun test
```

### Run a single test file

```sh
bun test src/index.test.ts
```

### Run tests matching a name pattern

```sh
bun test --test-name-pattern "pattern here"
```

### Run tests in watch mode

```sh
bun test --watch
```

---

## Bun-Native APIs (Preferred Over Third-Party)

Always use Bun's built-in APIs instead of third-party equivalents:

| Task             | Use                             | Do NOT use                      |
| ---------------- | ------------------------------- | ------------------------------- |
| Run a file       | `bun <file>`                    | `node <file>`, `ts-node <file>` |
| HTTP server      | `Bun.serve()`                   | `express`, `fastify`            |
| SQLite           | `bun:sqlite`                    | `better-sqlite3`                |
| Redis            | `Bun.redis`                     | `ioredis`                       |
| Postgres         | `Bun.sql`                       | `pg`, `postgres.js`             |
| WebSocket        | built-in `WebSocket`            | `ws`                            |
| File I/O         | `Bun.file()`                    | `node:fs` readFile/writeFile    |
| Shell commands   | `Bun.$\`cmd\``                  | `execa`, `child_process`        |
| Environment vars | automatic `.env` loading        | `dotenv`                        |
| Frontend         | `Bun.serve()` with HTML imports | `vite`, `webpack`, `esbuild`    |
| Testing          | `bun test`                      | `jest`, `vitest`                |

---

## TypeScript Configuration

Key settings from `tsconfig.json`:

- **`target`/`lib`**: `ESNext` — use modern JS, no polyfills needed.
- **`module: "Preserve"`** + **`moduleResolution: "bundler"`** — Bun bundler mode; preserves ESM as-is.
- **`allowImportingTsExtensions: true`** — import files with explicit `.ts`/`.tsx` extensions.
- **`verbatimModuleSyntax: true`** — type-only imports **must** use `import type`.
- **`noEmit: true`** — TypeScript is for type-checking only; Bun handles transpilation.
- **`strict: true`** — all strict checks enabled.
- **`noUncheckedIndexedAccess: true`** — array/object index access returns `T | undefined`.
- **`noImplicitOverride: true`** — class method overrides must use the `override` keyword.
- **`noUnusedLocals`/`noUnusedParameters`**: disabled — unused variables are tolerated.
- **`jsx: "react-jsx"`** — automatic JSX transform (no `React` import needed in JSX files).

---

## Code Style Guidelines

### Imports

- Use explicit `.ts`/`.tsx` file extensions in all local imports:
  ```ts
  import { foo } from "./foo.ts";
  import type { Bar } from "./bar.ts";
  ```
- Use `import type` for type-only imports (required by `verbatimModuleSyntax`):
  ```ts
  import type { MyType } from "./types.ts";
  ```
- No path aliases configured — use relative paths only.
- All files are ESM (`"type": "module"` in package.json); do not use `require()`.

### Formatting

- No Prettier or ESLint is configured. Follow consistent style manually.
- Use 2-space indentation (Bun/TypeScript community default).
- Trailing commas in multi-line arrays/objects/params.
- Single quotes for strings preferred; template literals for interpolation.

### Types & TypeScript

- Prefer explicit type annotations for function parameters and return types.
- Avoid `any`; use `unknown` when the type is truly unknown.
- Use `noUncheckedIndexedAccess` discipline: always handle the `undefined` case for array/object index access.
- Mark overriding class methods with `override`:
  ```ts
  class Derived extends Base {
    override method() { ... }
  }
  ```
- Use `satisfies` operator to validate objects against a type without widening.

### Naming Conventions

- **Files**: `kebab-case.ts` for modules, `PascalCase.ts` for classes/components.
- **Variables/functions**: `camelCase`.
- **Types/interfaces/classes**: `PascalCase`.
- **Constants**: `SCREAMING_SNAKE_CASE` for true module-level constants; `camelCase` for other `const` bindings.
- **Test files**: `*.test.ts` or `*.spec.ts` alongside the source file they test.

### Error Handling

- Prefer returning typed errors or `Result`-style patterns over throwing where practical.
- When catching, avoid swallowing errors silently — log or re-throw.
- Use `instanceof` checks for typed error handling:
  ```ts
  try {
    ...
  } catch (err) {
    if (err instanceof SomeError) { ... }
    throw err;
  }
  ```

### Testing

- Use Bun's built-in `bun:test` — do not install Jest or Vitest.

  ```ts
  import { test, expect, describe, beforeEach } from "bun:test";

  describe("MyModule", () => {
    test("does something", () => {
      expect(foo()).toBe("bar");
    });
  });
  ```

- Place test files next to the code they test, e.g., `foo.ts` → `foo.test.ts`.
- Test file discovery: `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, `**/*.spec.tsx`.

### Environment Variables

- Bun automatically loads `.env` — no `dotenv` package needed.
- Do not commit `.env` files (covered by `.gitignore`).

---

## Project Conventions (from .cursor/rules)

The `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc` rule applies to all `*.ts`, `*.tsx`, `*.html`, `*.css`, `*.js`, `*.jsx`, and `package.json` files:

> Default to using Bun instead of Node.js.
> `Bun.serve()` supports WebSockets, HTTPS, and routes — don't use Express.
> HTML imports with `Bun.serve()` for frontend — don't use Vite.
> `Bun.$` instead of execa.
> Bun automatically loads `.env` — don't use dotenv.
