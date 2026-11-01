const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const main = async () => {
  const root = path.resolve(__dirname, '..');
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-fenced-e2e-'));
  const workspace = path.join(testRoot, 'workspace');
  const artifacts = path.join(testRoot, 'artifacts');
  const extensions = path.join(testRoot, 'extensions');
  fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
  fs.mkdirSync(artifacts);
  // An isolated grammar-only extension verifies integration with installed
  // languages beyond VS Code's built-ins, without changing the user's profile.
  const fixture = path.join(extensions, 'todo-e2e-grammar');
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'package.json'),
    JSON.stringify({
      name: 'todo-e2e-grammar',
      publisher: 'test',
      version: '0.0.1',
      engines: { vscode: '^1.36.0' },
      contributes: {
        languages: [{ id: 'terraform', extensions: ['.tf'] }],
        grammars: [
          { language: 'terraform', scopeName: 'source.hcl', path: './grammar.tmLanguage.json' },
        ],
      },
    })
  );
  fs.writeFileSync(
    path.join(fixture, 'grammar.tmLanguage.json'),
    JSON.stringify({
      scopeName: 'source.hcl',
      patterns: [{ match: '\\bresource\\b', name: 'keyword.control.terraform.fixture' }],
    })
  );
  fs.writeFileSync(
    path.join(workspace, '.vscode/settings.json'),
    JSON.stringify(
      {
        'todo.archive.type': 'InSameFile',
        'todo.archive.remove.emptyProjects': false,
        'todo.archive.remove.emptyLines': -1,
        'todo.automaticSymbol': true,
        'editor.tabSize': 2,
        'editor.insertSpaces': true,
        'editor.detectIndentation': false,
        'editor.wordBasedSuggestions': 'off',
        'workbench.startupEditor': 'none',
        'extensions.ignoreRecommendations': true,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
      },
      null,
      2
    )
  );
  console.log(`E2E artifacts: ${artifacts}`);
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test/e2e/fenced-code.js'),
    extensionTestsEnv: { TODO_E2E_ARTIFACT_DIR: artifacts },
    launchArgs: [
      workspace,
      '--user-data-dir=' + path.join(testRoot, 'profile'),
      '--extensions-dir=' + extensions,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-updates',
    ],
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
