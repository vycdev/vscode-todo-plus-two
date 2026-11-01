const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const cases = [];
const verifiedLanguages = [];
const runCase = async (name, test) => {
  await test();
  cases.push(name);
  console.log('PASS: ' + name);
};
const open = async (name, text) => {
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, name);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  assert.strictEqual(document.languageId, 'todo');
  return editor;
};
const selectLine = (editor, line, character = 0) => {
  const position = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(position, position);
};
const replaceDocument = async (editor, text) => {
  const last = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  assert(
    await editor.edit((edit) =>
      edit.replace(new vscode.Range(new vscode.Position(0, 0), last), text)
    )
  );
  await editor.document.save();
};
const waitUntil = async (predicate, message) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

exports.run = async () => {
  const artifacts = process.env.TODO_E2E_ARTIFACT_DIR;
  const extension = vscode.extensions.getExtension('vycdev.vscode-todo-plus-two');
  assert(extension, 'Development extension is registered');
  await extension.activate();
  const source = [
    'Work:',
    '  ☐ real @id(real)',
    '  ✔ finished',
    '  ```python',
    'def hello(): return "hello"',
    '',
    'Archive:',
    '  ☐ fake @id(fake) @depends(missing) @due(2000-01-01)',
    '  ```',
    '  ☐ following @depends(real)',
  ].join('\n');
  const editor = await open('integration.todo', source);
  const document = editor.document;

  try {
    await runCase('real project symbols and whole-block folding', async () => {
      const symbols = await vscode.commands.executeCommand(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      );
      assert.deepStrictEqual(
        symbols.map((symbol) => symbol.name),
        ['Work']
      );
      assert.strictEqual(symbols[0].range.end.line, 9);
      const folds = await vscode.commands.executeCommand(
        'vscode.executeFoldingRangeProvider',
        document.uri
      );
      assert(folds.some((fold) => fold.start === 3 && fold.end === 7));
    });

    await runCase('Todo commands leave fenced task examples untouched', async () => {
      selectLine(editor, 7);
      await vscode.commands.executeCommand('todo.toggleDone');
      assert.strictEqual(document.getText(), source);
      await vscode.commands.executeCommand('notifications.clearAll');
    });

    await runCase('Todo completion and dependency links exclude code', async () => {
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(7, 25)
      );
      assert(
        !completions || completions.items.every((item) => !String(item.label).startsWith('@')),
        'Unexpected Todo completions in code: ' +
          JSON.stringify(completions && completions.items.map((item) => item.label))
      );
      const links = await vscode.commands.executeCommand(
        'vscode.executeLinkProvider',
        document.uri
      );
      assert(links.every((link) => link.range.start.line !== 7));
      assert(links.some((link) => link.range.start.line === 9));
      const outside = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        document.uri,
        new vscode.Position(9, document.lineAt(9).text.length - 1)
      );
      assert(outside.items.some((item) => item.label === 'real'));
      assert(!outside.items.some((item) => item.label === 'fake'));
    });

    await runCase('archive and unarchive preserve complete attached code', async () => {
      await vscode.commands.executeCommand('todo.archive');
      const archived = document.getText();
      assert(archived.includes('Archive:\n  Work:\n    ✔ finished\n    ```python'));
      assert(archived.includes('def hello(): return "hello"\n\nArchive:\n'));
      assert.strictEqual((archived.match(/@id\(fake\)/g) || []).length, 1);
      const taskLine = archived.split('\n').findIndex((line) => line.includes('✔ finished'));
      selectLine(editor, taskLine);
      await vscode.commands.executeCommand('todo.unarchive');
      const restored = document.getText();
      assert(
        restored.includes(
          '  ✔ finished\n  ```python\ndef hello(): return "hello"\n\nArchive:\n  ☐ fake'
        )
      );
      assert.strictEqual((restored.match(/@id\(fake\)/g) || []).length, 1);
    });

    await runCase('live fence edits refresh real dependency diagnostics', async () => {
      await replaceDocument(
        editor,
        source.replace('  ```python', '  ---').replace('  ```\n', '  ---\n')
      );
      await waitUntil(
        () =>
          vscode.languages
            .getDiagnostics(document.uri)
            .some((diagnostic) => diagnostic.message.includes('missing')),
        'Exposed example gets a dependency diagnostic'
      );
      await replaceDocument(editor, source);
      await waitUntil(
        () =>
          !vscode.languages
            .getDiagnostics(document.uri)
            .some((diagnostic) => diagnostic.message.includes('missing')),
        'Reclosed code clears the dependency diagnostic'
      );
    });

    await runCase(
      'automatic Enter does not insert Todo symbols inside fallback fences',
      async () => {
        const fallback = await open('fallback.todo', '```unknown-language\n☐ literal example\n```');
        selectLine(fallback, 1, fallback.document.lineAt(1).text.length);
        await vscode.commands.executeCommand('type', { text: '\n' });
        assert.strictEqual(fallback.document.lineAt(2).text.trim(), '');
      }
    );

    await runCase('numbered-list Enter leaves fenced examples literal', async () => {
      const numbered = await open('numbered.todo', '```text\n1. Example\n2. Leave alone\n```');
      selectLine(numbered, 1, numbered.document.lineAt(1).text.length);
      await vscode.commands.executeCommand('todo.numberedListEnter');
      assert.strictEqual(numbered.document.lineAt(2).text.trim(), '');
      assert.strictEqual(numbered.document.lineAt(3).text, '2. Leave alone');
    });

    await runCase('live workbench grammar and theme colors for installed languages', async () => {
      const examples = [
        ['python', 'def hello(): return "hello"', 'python'],
        ['cpp', 'const int value = 42;', 'cpp'],
        ['csharp', 'class Example { int value = 42; }', 'csharp'],
        ['bash', 'if true; then echo "hello"; fi', 'shellscript'],
        ['rust', 'fn main() { let value = 42; }', 'rust'],
        ['go', 'func main() { value := 42 }', 'go'],
        ['html', '<div class="hello">hello</div>', 'html'],
        ['json', '{ "value": 42 }', 'json'],
        ['yml', 'value: 42', 'yaml'],
        ['js', 'const value = "hello";', 'javascript'],
        ['jsx', 'const value = <div />;', 'javascriptreact'],
        ['ts', 'const value: number = 42;', 'typescript'],
        ['tsx', 'const value = <div />;', 'typescriptreact'],
        ['sql', 'SELECT * FROM users', 'sql'],
        ['terraform', 'resource "example" "sample" {}', 'source.hcl'],
      ];
      const text =
        examples.map(([alias, code]) => '```' + alias + '\n' + code + '\n```').join('\n') +
        '\n☐ after code';
      const syntaxEditor = await open('languages.todo', text);
      const commands = await vscode.commands.getCommands(false);
      assert(
        commands.includes('_workbench.captureSyntaxTokens'),
        'Workbench syntax capture is available'
      );
      const tokens = await vscode.commands.executeCommand(
        '_workbench.captureSyntaxTokens',
        syntaxEditor.document.uri
      );
      assert(Array.isArray(tokens) && tokens.length);
      fs.writeFileSync(path.join(artifacts, 'syntax-tokens.json'), JSON.stringify(tokens, null, 2));
      for (const [alias, , language] of examples) {
        const languageTokens = tokens.filter((token) =>
          token.t.includes('meta.embedded.block.' + language)
        );
        assert(
          languageTokens.some((token) =>
            /\b(keyword|storage|constant|string|entity)\./.test(token.t)
          ),
          alias + ' has real source-language tokens'
        );
        assert(
          languageTokens.some(
            (token) =>
              token.r &&
              Object.values(token.r).some((color) => color && !color.startsWith('default:'))
          ),
          alias + ' has theme-specific colors'
        );
        verifiedLanguages.push(alias);
      }
      assert(
        tokens.some(
          (token) =>
            token.c.includes('after code') && token.t.includes('markup.list.unchecked.todo')
        )
      );
    });

    fs.writeFileSync(
      path.join(artifacts, 'report.json'),
      JSON.stringify(
        {
          passed: cases,
          platform: process.platform,
          arch: process.arch,
          vscode: vscode.version,
          extension: extension.packageJSON.version,
          verifiedLanguages,
        },
        null,
        2
      )
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(artifacts, 'failure.json'),
      JSON.stringify({ passed: cases, error: error.stack }, null, 2)
    );
    throw error;
  }
};
