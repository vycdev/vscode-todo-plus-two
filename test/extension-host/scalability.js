const assert = require('assert');
const fs = require('fs');
const vscode = require('vscode');
const { performance } = require('perf_hooks');

// Run with code --extensionDevelopmentPath=<repo> --extensionTestsPath=<this file>
// and TODO_SCALABILITY_REPORT pointing at the desired JSON report.
exports.run = async () => {
  const reportPath = process.env.TODO_SCALABILITY_REPORT;
  assert(reportPath, 'TODO_SCALABILITY_REPORT must name the report file');
  const errors = [],
    timings = [];
  const listener = (error) => errors.push(String(error && (error.stack || error)));
  process.on('uncaughtException', listener);
  process.on('unhandledRejection', listener);
  try {
    const extension = vscode.extensions.getExtension('vycdev.vscode-todo-plus-two');
    assert(extension, 'Development extension was not loaded');
    await extension.activate();
    const lines = [];
    for (let index = 0; index < 7000; index++) {
      lines.push(index % 100 === 0 ? `Project ${index}:` : `  ☐ Task ${index} @high @est(10m)`);
    }
    const document = await vscode.workspace.openTextDocument({
      language: 'todo',
      content: lines.join('\n'),
    });
    const editor = await vscode.window.showTextDocument(document);
    const commandWithDocumentChange = async (command) => {
      let subscription, timeout;
      const changed = new Promise((resolve, reject) => {
        subscription = vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.document === document && event.contentChanges.length) resolve();
        });
        timeout = setTimeout(() => reject(new Error(`No document change after ${command}`)), 5000);
      });
      try {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand(command);
        await changed;
      } finally {
        subscription.dispose();
        clearTimeout(timeout);
      }
    };
    const replace = async (line, text) => {
      const start = performance.now();
      assert(await editor.edit((builder) => builder.replace(document.lineAt(line).range, text)));
      timings.push(performance.now() - start);
      assert.strictEqual(document.lineAt(line).text, text);
    };
    for (let index = 0; index < 20; index++) {
      await replace(1, `  ☐ Edited title ${index} @high @est(${10 + index}m)`);
      await replace(101, `  ${index % 2 ? '☐' : '✔'} Completed task @low`);
    }
    assert(
      await editor.edit((builder) =>
        builder.insert(new vscode.Position(2, 0), '  ☐ Added task @due(2027-01-01)\n')
      )
    );
    assert.strictEqual(document.lineCount, 7001);
    assert(await editor.edit((builder) => builder.delete(new vscode.Range(2, 0, 3, 0))));
    assert.strictEqual(document.lineCount, 7000);
    await commandWithDocumentChange('undo');
    assert.strictEqual(document.lineCount, 7001);
    await commandWithDocumentChange('redo');
    assert.strictEqual(document.lineCount, 7000);
    const secondEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
    assert(secondEditor);
    await replace(1, '  ☐ Final title @high @est(1h)');
    const sorted = timings.slice().sort((a, b) => a - b);
    assert.deepStrictEqual(errors, [], 'Extension Host reported asynchronous errors');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          vscode: vscode.version,
          lines: document.lineCount,
          edits: timings.length,
          medianEditMs: sorted[Math.floor(sorted.length / 2)],
          p95EditMs: sorted[Math.floor(sorted.length * 0.95)],
          checks: [
            'tagged title edits',
            'estimate edits',
            'completion',
            'line insertion/deletion',
            'undo/redo',
            'split editor',
          ],
          errors,
        },
        null,
        2
      )
    );
  } finally {
    process.removeListener('uncaughtException', listener);
    process.removeListener('unhandledRejection', listener);
  }
};
