# Contributing

Thanks for wanting to contribute to Todo+2. Contributions, issues and feedback are very welcome!

This document explains how to set up the project locally, install prerequisites, run the extension in the debugger while you work, and submit changes.

## Prerequisites

- Node.js 22.12 or newer on the 22.x line, or Node.js 24, for development and tests
- pnpm 10.33.4, pinned by `packageManager` in `package.json`
- Visual Studio Code 1.36 or newer to run the extension

Enable pnpm through Corepack (included with the supported Node.js installers):

```powershell
corepack enable pnpm
pnpm --version
```

## Install dependencies

From the repository root run:

```powershell
pnpm install
```

Corepack selects the repository's pinned pnpm version. If Corepack is unavailable,
install pnpm once with `npm install --global pnpm@10.33.4`.
If Corepack reports outdated signatures after enabling it, run `corepack disable pnpm`
before using that bootstrap command. This removes Corepack's `pnpm`/`pnpx` shims
so npm can install the pinned CLI without an `EEXIST` conflict.

This installs the runtime and development dependencies, including pinned TypeScript and VS Code API definitions. Use `pnpm install --frozen-lockfile` for a reproducible installation from `pnpm-lock.yaml`; CI always uses this mode. When intentionally changing dependencies, use `pnpm add`/`pnpm remove` and commit the updated lockfile. Do not generate a `package-lock.json`.

Development's Node.js requirement does not change the extension runtime: VS Code
1.36 / Node.js 10.11 remains supported. Keep the compiler and API definition pins.

## Validation

Run `pnpm run check` before submitting changes. It runs type checking, the test suite, the development build, and formatting checks. Run `pnpm run format` to apply the repository's Prettier configuration. Git stores text files with LF line endings so formatting checks behave consistently on Windows and Unix.

Tests run directly through the CommonJS TypeScript loader. They do not need an experimental Node.js ESM loader or a downloaded VS Code installation. VS Code declarations are checked against the declared minimum API version. Type checking skips third-party declaration internals because some pinned legacy dependencies use older Node definitions; application and test code are still checked.

Run `pnpm run test:e2e` for the separate Extension Development Host suite. It builds
the extension and launches VS Code with an isolated temporary workspace, profile,
and extensions directory. Set `VSCODE_EXECUTABLE_PATH` to an existing VS Code
executable to reuse it; otherwise the official test runner downloads VS Code.
The suite covers fenced syntax colors, an installed grammar contribution, task
commands, completion, links, diagnostics, folding, and archive/unarchive. It prints
the directory containing its JSON report and captured workbench syntax tokens.

For scalability changes, run `pnpm exec ts-node test/benchmarks/scalability.ts 7000`. It compares incremental edits with forced full cache rebuilds in a simulated editor and reports parsing, project computation, and decoration submission counts. These timings exclude VS Code rendering and IPC.

An optional check runs inside your installed VS Code in an isolated profile. It exercises tagged tasks, estimates, completion, line insertion/deletion, undo/redo, and split editors in a 7,000-line document:

```powershell
pnpm run compile
$todoTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('todo-scalability-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $todoTestRoot | Out-Null
$env:TODO_SCALABILITY_REPORT = Join-Path $todoTestRoot 'results.json'
code --new-window --user-data-dir (Join-Path $todoTestRoot 'user-data') --extensions-dir (Join-Path $todoTestRoot 'extensions') --extensionDevelopmentPath (Get-Location).Path --extensionTestsPath (Join-Path (Get-Location).Path 'test/extension-host/scalability.js') --skip-welcome --skip-release-notes --disable-workspace-trust --wait
Get-Content $env:TODO_SCALABILITY_REPORT
```

The Extension Host check verifies edits and reports asynchronous errors and edit round-trip timings. Inspect highlighting and project annotations manually when changing decoration behavior; VS Code does not expose applied decoration ranges for assertions.

## Build the extension

This project uses webpack 5 to compile the TypeScript source into `out/` (the compiled extension). It cleans the output directory before emitting files, targets Node.js 10.11 (the runtime shipped with VS Code 1.36), and limits minifier output to ES2017 syntax. Development tools use the newer Node.js versions listed above. Build commands from `package.json`:

```powershell
# One-time build (development mode)
pnpm run compile

# Build and watch for changes while you edit
pnpm run compile:watch

# Production build (also runs automatically when packaging)
pnpm run vscode:prepublish
```

Note: the `compile:watch` command is handy while debugging; it keeps `out/` updated automatically.

## Debugging the extension in VS Code

1. Open the project folder in VS Code.
2. Make sure the project is compiled at least once (`pnpm run compile`) or run `pnpm run compile:watch` in a terminal.
3. Open a TypeScript source file in `src/`.
4. Press F5 (or Run > Start Debugging). VS Code will open a new Extension Development Host window with the extension loaded.

Tips:

- Put breakpoints in the TypeScript files under `src/`. With `sourceMap: true` and `out/` present VS Code should hit breakpoints correctly.
- If breakpoints are skipped, stop the debug session, run a full compile (`pnpm run compile`), and start debugging again.

## Code-block language catalog

Fenced language names, aliases, and TextMate scopes are derived from GitHub Linguist.
`syntax/code-languages.json` records the pinned upstream source and its license;
`syntax/linguist-LICENSE.txt` must remain in the packaged extension.

After changing scope overrides in `scripts/generate-code-grammar.js`, run
`pnpm run generate:code-grammar`. It regenerates `syntax/fenced-code.tmLanguage.json`
and the manifest's embedded-language mappings entirely offline. Tests check that
these outputs match the catalog and generator.

To update the catalog, use `pnpm run generate:code-grammar --update <full-commit-SHA>`
with a reviewed commit from `github-linguist/linguist`. This explicit update downloads
the catalog and license; normal builds and extension use do not access the network.
Language grammars themselves are supplied by VS Code and installed extensions.

## Packaging locally

If you want to generate a `.vsix` to install locally or publish manually:

```powershell
# create a VSIX package
pnpm run package

# install the VSIX into your locally installed VS Code
code --install-extension .\vscode-todo-plus-two-<version>.vsix
```

Replace `<version>` with the actual package filename produced by `pnpm run package`.
The script runs pinned `@vscode/vsce` 4.1.0 through `pnpm dlx`, so no global
packaging tool is required. It runs `vscode:prepublish` and disables dependency
collection with `--no-dependencies`: webpack bundles the runtime dependencies,
including `moment` aliased to `moment-mini`. The VSIX excludes `node_modules`,
pnpm internals, and lockfiles. VSCE itself invokes the prepublish hook through npm;
the hook's type check and build use the pnpm-installed tools.

## Preparing and publishing a release

Release preparation happens on a `feat/` branch based on the latest `origin/develop`.
Open the preparation PR against `develop` and squash merge it after review.

1. Compare all changes since the latest published GitHub release and tag, including
   entries accidentally added beneath an older version in `CHANGELOG.md`. Keep
   published release notes unchanged and put every unreleased change in the new
   version's section.
2. Update the version in `package.json`. `pnpm-lock.yaml` does not store the root
   package version; update it only when dependencies change.
   Review README compatibility notes, settings, commands, and screenshots.
3. Run `pnpm install --frozen-lockfile` and `pnpm run check`. Run the Extension Host suites in a desktop
   session when validating release behavior: `pnpm run test:e2e` and
   `pnpm run test:e2e:tags`.
4. Build the candidate with `pnpm run package --githubBranch v<version>` so packaged
   README links refer to the intended release tag. Packaging runs the production
   build through `vscode:prepublish`. Inspect the VSIX as a ZIP: verify its version,
   bundle, grammars, licenses, icons, and README images; exclude source, tests,
   dependencies, source maps, and local Git metadata. Install and smoke-test the
   actual VSIX in an isolated VS Code profile. Record its SHA-256 checksum.

The following are separate publication steps for a maintainer after approving the
candidate; preparing the release does not perform them. The 5.3.0 release used a
`develop` to `master` promotion with a merge commit, preserving shared history.
Repeat that promotion after the preparation PR is merged and checks pass, then:

1. Check out and pull `master`; verify it contains the reviewed release changes
   and the intended package version. If anything changed after candidate
   validation, rebuild and retest the VSIX.
2. Create and push `v<version>` on that stable commit.
3. Publish the approved artifact to the VS Code Marketplace with
   `pnpm run publish --packagePath <path-to-approved.vsix>`. This publishes the exact
   inspected bytes. `pnpm run publish` without arguments rebuilds and publishes
   from the current checkout. Always include `run`: `pnpm publish` is pnpm's
   registry-publication command, whereas this script publishes only to the
   VS Code Marketplace.
4. Create the GitHub release for the same tag, attach the approved VSIX, and use
   the new changelog section for its highlights and migration notes.

There is no automatic tag or Marketplace publishing workflow in this repository;
the GitHub Actions workflow runs validation on `develop` and its pull requests.

## How to contribute (recommended workflow)

1. Fork the repository on GitHub.
2. Create a descriptive branch for your change:

```powershell
# from your local clone
git checkout -b feat/awesome-improvement
```

3. Make your changes and run `pnpm run check`.
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
