const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const { runTests } = require('@vscode/test-electron');

const main = async () => {
  const repository = path.resolve(__dirname, '../..');
  const artifacts =
    process.env.TODO_E2E_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'todo-tags-e2e-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'workspace-'));
  fs.mkdirSync(path.join(workspace, '.vscode'));
  fs.writeFileSync(
    path.join(workspace, '.vscode/settings.json'),
    JSON.stringify(
      {
        'workbench.startupEditor': 'none',
        'workbench.colorTheme': 'Default Dark Modern',
        'security.workspace.trust.enabled': false,
        'files.autoSave': 'off',
        'editor.fontSize': 14,
        'editor.minimap.enabled': false,
        'todo.archive.type': 'InSameFile',
        'todo.file.include': ['**/scenario.todo'],
        'todo.markdown.include': ['**/notes.md'],
        'todo.timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
        'todo.statistics.project.enabled': false,
        'todo.statistics.statusbar.enabled': false,
        'todo.tags.styles': {
          blocked: { color: '#ff0000', bold: true },
          review: { color: '#00ff00', italic: true },
          obsolete: { strikethrough: true },
        },
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(workspace, 'scenario.todo'),
    [
      'Tasks:',
      '  ☐ E2EAlpha @blocked @review',
      '  ☐ E2EBeta @review @blocked',
      '  ☐ E2ETimer @id(timer) @depends(@paused) @note(@paused)',
      '  ☐ E2ELiteral @note(`literal) @blocked `code`',
      '  ☐ E2ECosmetic @obsolete',
      '  ✔ E2EDependency @id(@paused) @done',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(workspace, 'notes.md'),
    [
      '# Tasks',
      '- [ ] E2EMarkdown @blocked @review',
      '- [ ] E2EProtected \\@blocked <!-- @review --> `@blocked` @note(@blocked)',
      '- [ ] E2EMarkdownTimer @note(@paused) <!-- @paused @toggle(2020-01-01 00:00:00) -->',
      '',
    ].join('\n')
  );
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  console.log(`E2E artifacts: ${artifacts}`);
  const code = await runTests({
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    cachePath:
      process.env.VSCODE_TEST_CACHE_PATH || path.join(os.tmpdir(), 'todo-vscode-test-cache'),
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: repository,
    extensionTestsPath: path.join(__dirname, 'suite.js'),
    extensionTestsEnv: {
      TODO_E2E_ARTIFACT_DIR: artifacts,
      TODO_E2E_DEBUG_PORT: String(port),
      TODO_E2E_COMMIT: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim(),
    },
    launchArgs: [
      workspace,
      `--user-data-dir=${path.join(workspace, 'profile')}`,
      `--extensions-dir=${path.join(workspace, 'extensions')}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  });
  if (code) throw new Error(`VS Code exited with ${code}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
