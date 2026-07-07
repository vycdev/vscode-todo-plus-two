# Todo+2

TypeScript, VS Code extension (vscode API ^1.25), webpack, moment-mini, mocha+chai.

## Commands

```bash
npm install          # install deps
npm run compile      # webpack dev build → out/
npm run compile:watch
npm run test         # mocha tests in test/
npm run format       # prettier --write
npm run format:check
```

Debug: open in VS Code, F5 launches Extension Dev Host. Sourcemaps active — breakpoints in `src/` work.

## CHANGELOG

User-visible changes go in `CHANGELOG.md`, newest version at top. Each version header is `### Version X.Y.Z`. Group entries under feature additions or fixes. Link GitHub issue numbers when applicable. Always update it in the same PR that adds or changes user-facing behaviour.

## Branching & PRs

- `master` = stable (v5.2.0 latest published)
- `develop` = next release. **All PRs target develop.**
- Branch naming: `feat/` (feature), `fix/` (bug)
- Keep PRs small and focused. Squash merge.

## Code style

```typescript
// Prettier formatting. Single-quote strings. 2-space indent. Semicolons.
// Classes use decorators. Everything else is plain functions/consts.

// Export named, never default
export const activate = (context: ExtensionContext): void => { ... };

// Commands register in commands.ts, not extension.ts
// Extension.ts wires disposables and subscriptions only
// Types from vscode never imported as wildcard — import type { ... } from 'vscode'
```

## Architecture

- `src/extension.ts` — activation, disposable registration, event wiring
- `src/commands.ts` — all command registrations
- `src/todo/document.ts` — `.todo` file parser/serializer (the core model)
- `src/todo/items/` — domain types: Todo, Project, Tag, Comment, Archive, Line
- `src/todo/decorators/` — VS Code text editor decorations per item type
- `src/providers/` — language features: completion, dependency links, symbols
- `src/views/` — tree views: files, embedded todos
- `src/statusbars/` — statistics + timer status bar items
- `src/utils/embedded/providers/` — ag, rg, js backends for embedded code todos

Two independent todo sources with separate views:
1. `.todo` files (structured project/todo format)
2. Embedded todos (regex-extracted from code comments)

## Key constraints

- **No runtime npm deps beyond vscode API.** moment-mini (aliased from moment) is the only exception.
- **@id / @depends must stay portable.** IDs are plain text, survive copy/move/archive. Cross-file resolution via `dependency_index.ts`.
- **Archive**: completed items move under an "Archive" project. Configurable storage: same file, single workspace file, or per-file.
- **Event propagation**: `.todo` file edits re-parse → fire events → views/stats/decorations update reactively.

## Boundaries

- Never modify generated output in `out/`, `dist/`, or `node_modules/`
- Never commit package-lock.json (in .gitignore)
- Never add runtime dependencies without explaining why in the PR
- Follow symlinks only when `todo.followSymlinks` is enabled (default: false)

## Config

All settings under `todo.*`. Key prefix groups:

- `todo.file.*` — file discovery, includes/excludes, default content
- `todo.symbols.*` — box/done/cancelled characters
- `todo.colors.*` — per-element colors (done, project, tag, id, dependency, etc.)
- `todo.timekeeping.*` — @created, @started, @done, @lasted format
- `todo.archive.*` — archive behaviour and storage type
- `todo.statistics.*` — project & statusbar stats
- `todo.timer.*` — statusbar timer for started todos
- `todo.embedded.*` — embedded todos batch size and comment visibility
- `todo.followSymlinks` — follow symlinks during file enumeration

Types are in `src/config.ts`. Defaults in `package.json` under `contributes.configuration.properties`.