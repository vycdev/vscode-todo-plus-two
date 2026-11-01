// Run on a desktop: pnpm run compile && node scripts/capture-readme.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-readme-')));
  const workspace = path.join(temporary, 'Release workspace');
  const artifacts = process.env.TODO_SCREENSHOT_DIR || path.join(temporary, 'screenshots');
  fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });
  fs.copyFileSync(path.join(root, 'resources/readme.todo'), path.join(workspace, 'release.todo'));
  fs.writeFileSync(
    path.join(workspace, 'notes.md'),
    '# Release notes\n\nKeep design decisions beside the work.\n\n## Tasks\n\n- [ ] Publish the API @id(markdown-api) @high @due(2026-11-01)\n- [ ] Ship the client @depends(markdown-api) @review\n  - [x] Write migration tests @done\n- [ ] Review documentation @started(26-11-01 09:30) @toggle(26-11-01 09:45) @paused\n\n## Examples\n\n```typescript\n// A code example stays literal.\nconst checklist = "- [ ] Not a task";\n```\n'
  );
  fs.writeFileSync(
    path.join(workspace, 'release.ts'),
    '// TODO: Validate the release manifest\nexport const version = "5.4";\n\n// TODO: Check migration coverage\nexport const migrations = [];\n\n// FIXME: Handle an unavailable registry\nexport async function publish() {\n  return fetch("/api/releases");\n}\n'
  );
  fs.writeFileSync(
    path.join(workspace, '.vscode/settings.json'),
    JSON.stringify(
      {
        'workbench.startupEditor': 'none',
        'workbench.colorTheme': 'Default Dark Modern',
        'window.commandCenter': false,
        'editor.fontSize': 16,
        'editor.lineHeight': 25,
        'editor.minimap.enabled': false,
        'editor.stickyScroll.enabled': false,
        'editor.renderLineHighlight': 'none',
        'editor.wordWrap': 'off',
        'editor.tabSize': 2,
        'editor.detectIndentation': false,
        'editor.hover.enabled': false,
        'breadcrumbs.enabled': false,
        'security.workspace.trust.enabled': false,
        'todo.archive.type': 'InSameFile',
        'todo.file.include': ['**/*.todo'],
        'todo.markdown.include': ['**/notes.md'],
        'todo.file.view.showTags': false,
        'todo.embedded.provider': 'javascript',
        'todo.embedded.view.sort': 'manual',
        'todo.embedded.view.groupByRoot': false,
        'todo.embedded.view.groupByFile': false,
        'todo.tags.styles': { review: { color: '#e5d145', italic: true } },
      },
      null,
      2
    )
  );
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  console.log(`Screenshots: ${artifacts}`);
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'readme-screenshots.js'),
    extensionTestsEnv: {
      TODO_SCREENSHOT_DIR: artifacts,
      TODO_SCREENSHOT_PORT: String(port),
      TODO_SCREENSHOT_SOURCE: process.env.TODO_SCREENSHOT_SOURCE || '',
    },
    launchArgs: [
      workspace,
      `--user-data-dir=${path.join(temporary, 'profile')}`,
      `--extensions-dir=${path.join(temporary, 'extensions')}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
