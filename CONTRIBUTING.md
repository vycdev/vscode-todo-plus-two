# Contributing

Thanks for wanting to contribute to Todo+2. Contributions, issues and feedback are very welcome!

This document explains how to set up the project locally, install prerequisites, run the extension in the debugger while you work, and submit changes.

## Prerequisites

- Node.js 22 or 24 and npm for development and tests
- Visual Studio Code 1.36 or newer to run the extension
- (Optional) `vsce` if you want to package/publish the extension locally:

```powershell
npm install -g vsce
```

## Install dependencies

From the repository root run:

```powershell
npm install
```

This installs the runtime and development dependencies, including pinned TypeScript and VS Code API definitions. Use `npm ci` for a reproducible installation from the lockfile.

## Validation

Run `npm run check` before submitting changes. It runs type checking, the test suite, the development build, and formatting checks. Run `npm run format` to apply the repository's Prettier configuration. Git stores text files with LF line endings so formatting checks behave consistently on Windows and Unix.

Tests run directly through the CommonJS TypeScript loader. They do not need an experimental Node.js ESM loader or a downloaded VS Code installation. VS Code declarations are checked against the declared minimum API version. Type checking skips third-party declaration internals because some pinned legacy dependencies use older Node definitions; application and test code are still checked.

Run `npm run test:e2e` for the separate Extension Development Host suite. It builds
the extension and launches VS Code with an isolated temporary workspace, profile,
and extensions directory. Set `VSCODE_EXECUTABLE_PATH` to an existing VS Code
executable to reuse it; otherwise the official test runner downloads VS Code.
The suite covers fenced syntax colors, an installed grammar contribution, task
commands, completion, links, diagnostics, folding, and archive/unarchive. It prints
the directory containing its JSON report and captured workbench syntax tokens.

For scalability changes, run `npx ts-node test/benchmarks/scalability.ts 7000`. It compares incremental edits with forced full cache rebuilds in a simulated editor and reports parsing, project computation, and decoration submission counts. These timings exclude VS Code rendering and IPC.

An optional check runs inside your installed VS Code in an isolated profile. It exercises tagged tasks, estimates, completion, line insertion/deletion, undo/redo, and split editors in a 7,000-line document:

```powershell
npm run compile
$todoTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('todo-scalability-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $todoTestRoot | Out-Null
$env:TODO_SCALABILITY_REPORT = Join-Path $todoTestRoot 'results.json'
code --new-window --user-data-dir (Join-Path $todoTestRoot 'user-data') --extensions-dir (Join-Path $todoTestRoot 'extensions') --extensionDevelopmentPath (Get-Location).Path --extensionTestsPath (Join-Path (Get-Location).Path 'test/extension-host/scalability.js') --skip-welcome --skip-release-notes --disable-workspace-trust --wait
Get-Content $env:TODO_SCALABILITY_REPORT
```

The Extension Host check verifies edits and reports asynchronous errors and edit round-trip timings. Inspect highlighting and project annotations manually when changing decoration behavior; VS Code does not expose applied decoration ranges for assertions.

## Build the extension

This project uses webpack to compile the TypeScript source into `out/` (the compiled extension). Build commands from `package.json`:

```powershell
# One-time build (development mode)
npm run compile

# Build and watch for changes while you edit
npm run compile:watch

# Publish
npm run publish
```

Note: the `compile:watch` command is handy while debugging; it keeps `out/` updated automatically.

## Debugging the extension in VS Code

1. Open the project folder in VS Code.
2. Make sure the project is compiled at least once (`npm run compile`) or run `npm run compile:watch` in a terminal.
3. Open a TypeScript source file in `src/`.
4. Press F5 (or Run > Start Debugging). VS Code will open a new Extension Development Host window with the extension loaded.

Tips:

- Put breakpoints in the TypeScript files under `src/`. With `sourceMap: true` and `out/` present VS Code should hit breakpoints correctly.
- If breakpoints are skipped, stop the debug session, run a full compile (`npm run compile`), and start debugging again.

## Code-block language catalog

Fenced language names, aliases, and TextMate scopes are derived from GitHub Linguist.
`syntax/code-languages.json` records the pinned upstream source and its license;
`syntax/linguist-LICENSE.txt` must remain in the packaged extension.

After changing scope overrides in `scripts/generate-code-grammar.js`, run
`npm run generate:code-grammar`. It regenerates `syntax/fenced-code.tmLanguage.json`
and the manifest's embedded-language mappings entirely offline. Tests check that
these outputs match the catalog and generator.

To update the catalog, use `npm run generate:code-grammar -- --update <full-commit-SHA>`
with a reviewed commit from `github-linguist/linguist`. This explicit update downloads
the catalog and license; normal builds and extension use do not access the network.
Language grammars themselves are supplied by VS Code and installed extensions.

## Packaging locally

If you want to generate a `.vsix` to install locally or publish manually:

```powershell
# create a VSIX package
vsce package

# install the VSIX into your locally installed VS Code
code --install-extension .\vscode-todo-plus-two-<version>.vsix
```

Replace `<version>` with the actual package filename produced by `vsce package`.

## How to contribute (recommended workflow)

1. Fork the repository on GitHub.
2. Create a descriptive branch for your change:

```powershell
# from your local clone
git checkout -b feat/awesome-improvement
```

3. Make your changes and run `npm run check`.
4. Commit changes with clear messages and push your branch to your fork.
5. Open a Pull Request against the `develop` branch of `vycdev/vscode-todo-plus-two` and describe the change. Pull requests are squash merged.

Guidelines:

- Follow the existing code style and keep changes small and focused.
- Update `readme.md` and `changelog.md` when adding or changing user-visible features.
- If your change requires new dependencies, explain why in the PR.

## Reporting bugs & feature requests

Please open issues in the repository: https://github.com/vycdev/vscode-todo-plus-two/issues

When reporting a bug, include:

- VS Code version
- Extension version (package.json `version`)
- Steps to reproduce
- Expected vs actual behavior
- Any relevant logs from the Extension Development Host console

## License

This project is MIT licensed (see the `license` file).
