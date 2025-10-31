# Contributing

Thanks for wanting to contribute to Todo+2. Contributions, issues and feedback are very welcome!

This document explains how to set up the project locally, install prerequisites, run the extension in the debugger while you work, and submit changes.

## Prerequisites

- Node.js (LTS recommended) and npm
- (Optional) `vsce` if you want to package/publish the extension locally:

```powershell
npm install -g vsce
```

## Install dependencies

From the repository root run:

```powershell
npm install
```

This will install runtime and dev dependencies listed in `package.json`.

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
3. Open `extension.js`.
4. Press F5 (or Run > Start Debugging). VS Code will open a new Extension Development Host window with the extension loaded.

Tips:

- Put breakpoints in the TypeScript files under `src/`. With `sourceMap: true` and `out/` present VS Code should hit breakpoints correctly.
- If breakpoints are skipped, stop the debug session, run a full compile (`npm run compile`), and start debugging again.

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

3. Make your changes, run `npm run compile` or `npm run compile:watch`.
4. Commit changes with clear messages and push your branch to your fork.
5. Open a Pull Request against `vycdev/vscode-todo-plus-two` and describe the change.

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
