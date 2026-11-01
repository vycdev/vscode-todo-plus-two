const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vscode = require('vscode');

const waitFor = async (read, predicate, description) => {
  const deadline = Date.now() + 15000;
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${description}: ${JSON.stringify(last)}`);
};

const connectRenderer = async () => {
  const targets = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${process.env.TODO_E2E_DEBUG_PORT}/json/list`, (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
  const target = targets.find(
    (candidate) => candidate.type === 'page' && candidate.url.includes('workbench')
  );
  assert(target, 'VS Code renderer debug target is available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Renderer timeout: ${method}`));
      }, 10000);
      pending.set(requestId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  return { call, close: () => socket.close() };
};

module.exports.run = async () => {
  const artifacts = process.env.TODO_E2E_ARTIFACT_DIR;
  const report = {
    commit: process.env.TODO_E2E_COMMIT,
    platform: process.platform,
    arch: process.arch,
    vscode: vscode.version,
    steps: [],
  };
  let renderer;
  const step = async (name, action) => {
    const started = Date.now();
    let timeout;
    try {
      await Promise.race([
        action(),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`E2E step timed out: ${name}`)), 45000);
        }),
      ]);
    } catch (error) {
      report.steps.push({ name, status: 'failed', durationMs: Date.now() - started });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    report.steps.push({ name, status: 'passed', durationMs: Date.now() - started });
    console.log(`E2E PASS: ${name}`);
  };
  const style = async (token, all = false) => {
    const expression = `(() => {
      const lines = [...document.querySelectorAll('.monaco-editor .view-line')].filter(el => el.textContent.includes(${JSON.stringify(token)}));
      return lines.map(line => {
      const span = [...line.querySelectorAll('span')].reverse().find(el => el.textContent.includes(${JSON.stringify(token)}));
      if (!span) return null;
      const css = getComputedStyle(span);
      const rect = span.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const backgrounds = [...span.closest('.monaco-editor').querySelectorAll('.view-overlays *')].filter(el => {
        const box = el.getBoundingClientRect();
        return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
      }).map(el => getComputedStyle(el).backgroundColor);
      backgrounds.push(css.backgroundColor);
      let decoration = ''; for (let node = span; node && node !== line; node = node.parentElement) decoration += ' ' + getComputedStyle(node).textDecorationLine;
      return {color: css.color, backgrounds, weight: css.fontWeight, italic: css.fontStyle, decoration, text: line.textContent};
      });
    })()`;
    const result = await renderer.call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return all ? result.result.value : result.result.value[0];
  };
  const expectStyle = (token, predicate) =>
    waitFor(
      () => style(token),
      (value) => value && predicate(value),
      `Rendered style for ${token}`
    );
  const screenshot = async (name) => {
    const result = await renderer.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  const open = async (filename, column = vscode.ViewColumn.One) => {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filename);
    const document = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(document, { viewColumn: column, preview: false });
  };
  const select = (editor, token) => {
    const line = editor.document
      .getText()
      .split('\n')
      .findIndex((text) => text.includes(token));
    assert(line >= 0, `Task exists: ${token}`);
    editor.selection = new vscode.Selection(line, 0, line, 0);
    editor.revealRange(editor.selection);
    return editor.document.lineAt(line);
  };
  const text = (editor, token) => select(editor, token).text;
  const command = (name) => vscode.commands.executeCommand(`todo.${name}`);
  const marker = (value) => /(?:^|\s)@paused(?:\s|$)/.test(value);
  const settings = vscode.workspace.getConfiguration('todo');
  const setTheme = async (theme) => {
    await vscode.workspace
      .getConfiguration('workbench')
      .update(
        'colorTheme',
        theme === 'dark' ? 'Default Dark Modern' : 'Default Light Modern',
        vscode.ConfigurationTarget.Workspace
      );
    const expected = theme === 'dark' ? vscode.ColorThemeKind.Dark : vscode.ColorThemeKind.Light;
    await waitFor(
      () => vscode.window.activeColorTheme.kind,
      (kind) => kind === expected,
      `Active ${theme} theme`
    );
  };
  try {
    await step('activate the real extension in a desktop VS Code host', async () => {
      const extension = vscode.extensions.getExtension('vycdev.vscode-todo-plus-two');
      assert(extension, 'Development extension is installed');
      await extension.activate();
      assert(extension.isActive);
      renderer = await connectRenderer();
    });
    let todo;
    await step(
      'render last-tag precedence, combined font styles, and literal arguments',
      async () => {
        todo = await open('scenario.todo');
        assert.strictEqual(todo.document.languageId, 'todo');
        await expectStyle(
          'E2EAlpha',
          (css) =>
            css.color === 'rgb(0, 255, 0)' && Number(css.weight) >= 600 && css.italic === 'italic'
        );
        await expectStyle('E2EBeta', (css) => css.color === 'rgb(255, 0, 0)');
        await expectStyle('E2ELiteral', (css) => css.color === 'rgb(255, 0, 0)');
        await expectStyle('E2ECosmetic', (css) => css.decoration.includes('line-through'));
        assert(text(todo, 'E2ECosmetic').includes('☐'));
        await screenshot('todo-styles');
      }
    );
    await step(
      'start and pause a task while preserving dependency and note arguments',
      async () => {
        select(todo, 'E2ETimer');
        await command('toggleStart');
        assert(text(todo, 'E2ETimer').includes('@started('));
        await command('toggleTimer');
        assert(marker(text(todo, 'E2ETimer')));
        assert(text(todo, 'E2ETimer').includes('@depends(@paused) @note(@paused)'));
        await expectStyle('E2ETimer', (css) => css.color === 'rgb(229, 209, 69)');
        await screenshot('todo-paused');
      }
    );
    await step('undo and redo timer history and its marker atomically', async () => {
      await vscode.commands.executeCommand('undo');
      assert(!marker(text(todo, 'E2ETimer')));
      assert(!text(todo, 'E2ETimer').includes('@toggle('));
      assert(text(todo, 'E2ETimer').includes('@started('));
      await vscode.commands.executeCommand('redo');
      assert(marker(text(todo, 'E2ETimer')));
      assert(text(todo, 'E2ETimer').includes('@toggle('));
    });
    await step('resume and repair a manually edited paused history', async () => {
      await command('toggleTimer');
      assert(!marker(text(todo, 'E2ETimer')));
      const line = select(todo, 'E2ETimer');
      await todo.edit((edit) =>
        edit.replace(
          line.range,
          '  ☐ E2ETimer @id(timer) @depends(@paused) @note(@paused) @started(2020-01-01 10:00:00) @toggle(2020-01-01 10:30:00)'
        )
      );
      await command('syncPausedTags');
      assert(marker(text(todo, 'E2ETimer')));
      await expectStyle('E2ETimer', (css) => css.color === 'rgb(229, 209, 69)');
    });
    await step(
      'complete and reopen paused history with correct elapsed time and styles',
      async () => {
        await command('toggleDone');
        assert(text(todo, 'E2ETimer').includes('✔'));
        assert(text(todo, 'E2ETimer').includes('@lasted(30m)'));
        assert(!marker(text(todo, 'E2ETimer')));
        await expectStyle(
          'E2ETimer',
          (css) => css.color === 'rgb(166, 226, 46)' && css.decoration.includes('line-through')
        );
        await screenshot('todo-completed');
        await command('toggleDone');
        assert(text(todo, 'E2ETimer').includes('☐'));
        assert(marker(text(todo, 'E2ETimer')));
        await expectStyle(
          'E2ETimer',
          (css) => css.color === 'rgb(229, 209, 69)' && !css.decoration.includes('line-through')
        );
      }
    );
    let markdown;
    await step('style native Markdown tasks and protect escaped and hidden tags', async () => {
      markdown = await open('notes.md', vscode.ViewColumn.Two);
      assert.strictEqual(markdown.document.languageId, 'markdown');
      await expectStyle('E2EMarkdown', (css) => css.color === 'rgb(0, 255, 0)');
      await expectStyle(
        'E2EProtected',
        (css) => !['rgb(255, 0, 0)', 'rgb(0, 255, 0)'].includes(css.color)
      );
    });
    await step('pause and resume Markdown timers without rewriting hidden examples', async () => {
      const hidden = '<!-- @paused @toggle(2020-01-01 00:00:00) -->';
      select(markdown, 'E2EMarkdownTimer');
      await command('toggleStart');
      await command('toggleTimer');
      assert(text(markdown, 'E2EMarkdownTimer').includes(`@paused ${hidden}`));
      assert(text(markdown, 'E2EMarkdownTimer').includes('@note(@paused)'));
      await expectStyle('E2EMarkdownTimer', (css) => css.color === 'rgb(229, 209, 69)');
      await screenshot('markdown-paused');
      await command('toggleTimer');
      assert(!marker(text(markdown, 'E2EMarkdownTimer').replace(hidden, '')));
      assert(text(markdown, 'E2EMarkdownTimer').includes(hidden));
    });
    await step('refresh priority changes in both visible editors', async () => {
      await settings.update(
        'tags.styles',
        {
          blocked: { color: '#ff0000', bold: true },
          review: { priority: 5, color: '#ff00ff', italic: true, light: { color: '#112233' } },
          obsolete: { strikethrough: true },
        },
        vscode.ConfigurationTarget.Workspace
      );
      await expectStyle('E2EBeta', (css) => css.color === 'rgb(255, 0, 255)');
      await expectStyle('E2EMarkdown', (css) => css.color === 'rgb(255, 0, 255)');
    });
    await step('disable colors while preserving font styles', async () => {
      await settings.update('colors.enabled', false, vscode.ConfigurationTarget.Workspace);
      await expectStyle(
        'E2EMarkdown',
        (css) =>
          css.color !== 'rgb(255, 0, 255)' && css.italic === 'italic' && Number(css.weight) >= 600
      );
      await expectStyle('E2ECosmetic', (css) => css.decoration.includes('line-through'));
      await settings.update('colors.enabled', true, vscode.ConfigurationTarget.Workspace);
    });
    await step('apply light-theme rule overrides in the real renderer', async () => {
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Workspace);
      await expectStyle('E2EMarkdown', (css) => css.color === 'rgb(17, 34, 51)');
      await screenshot('light-theme-styles');
    });
    await step('clear obsolete styles after removing tags', async () => {
      const line = select(markdown, 'E2EMarkdown');
      await markdown.edit((edit) => edit.replace(line.range, '- [ ] E2EMarkdown'));
      await expectStyle(
        'E2EMarkdown',
        (css) =>
          css.color !== 'rgb(17, 34, 51)' && css.italic !== 'italic' && Number(css.weight) < 600
      );
    });
    await step('archive only finished tasks and restore their portable metadata', async () => {
      todo = await open('scenario.todo');
      select(todo, 'E2ETimer');
      await command('toggleDone');
      await command('archive');
      assert(todo.document.getText().includes('Archive:'));
      assert(
        todo.document.getText().indexOf('E2ECosmetic') < todo.document.getText().indexOf('Archive:')
      );
      select(todo, 'E2ETimer');
      await command('unarchive');
      assert(
        todo.document.getText().indexOf('E2ETimer') < todo.document.getText().indexOf('Archive:')
      );
      assert(text(todo, 'E2ETimer').includes('@id(timer) @depends(@paused) @note(@paused)'));
      await todo.document.save();
      await markdown.document.save();
    });
    await step(
      'clear theme colors and backgrounds without falling back to base styles',
      async () => {
        const line = select(todo, 'E2ECosmetic');
        await todo.edit((edit) => edit.replace(line.range, '  ☐ E2ECosmetic @reset'));
        for (const theme of ['dark', 'light']) {
          const other = theme === 'dark' ? 'light' : 'dark';
          await settings.update(
            'tags.styles',
            {
              reset: {
                color: '#ff0000',
                backgroundColor: '#ffff00',
                [theme]: { color: '', backgroundColor: '' },
                [other]: { color: '#112233', backgroundColor: '#ddeeff' },
              },
            },
            vscode.ConfigurationTarget.Workspace
          );
          await setTheme(theme);
          await expectStyle(
            'E2ECosmetic',
            (css) => css.color !== 'rgb(255, 0, 0)' && !css.backgrounds.includes('rgb(255, 255, 0)')
          );
          await setTheme(other);
          await expectStyle(
            'E2ECosmetic',
            (css) =>
              css.color === 'rgb(17, 34, 51)' && css.backgrounds.includes('rgb(221, 238, 255)')
          );
        }
        await screenshot('theme-color-reset');
      }
    );
    await step('render explicit false font properties ahead of lower-priority styles', async () => {
      await settings.update(
        'tags.styles',
        {
          bold: { color: '#ff0000', bold: true, italic: true, strikethrough: true },
          plain: { priority: 5, bold: false, italic: false, strikethrough: false },
        },
        vscode.ConfigurationTarget.Workspace
      );
      const line = select(todo, 'E2ECosmetic');
      await todo.edit((edit) => edit.replace(line.range, '  ☐ E2ECosmetic @bold @plain'));
      await expectStyle(
        'E2ECosmetic',
        (css) =>
          css.color === 'rgb(255, 0, 0)' &&
          Number(css.weight) < 600 &&
          css.italic !== 'italic' &&
          !css.decoration.includes('line-through')
      );
      assert(text(todo, 'E2ECosmetic').includes('☐'));
    });
    await step('disable a matching rule without leaving stale task colors', async () => {
      await settings.update(
        'tags.styles',
        { bold: false, plain: { bold: false, italic: false, strikethrough: false } },
        vscode.ConfigurationTarget.Workspace
      );
      await expectStyle(
        'E2ECosmetic',
        (css) =>
          css.color !== 'rgb(255, 0, 0)' &&
          Number(css.weight) < 600 &&
          !css.decoration.includes('line-through')
      );
    });
    await step(
      'synchronize multiple selected tasks while retaining literal paused references',
      async () => {
        const archive = todo.document
          .getText()
          .split('\n')
          .findIndex((line) => line.startsWith('Archive:'));
        assert(archive >= 0);
        await todo.edit((edit) =>
          edit.insert(
            new vscode.Position(archive, 0),
            [
              '  ☐ E2EBulkPaused @id(@paused) @started(2020-01-01 10:00:00) @toggle(2020-01-01 10:30:00)',
              '  ☐ E2EBulkActive @note(@paused) @started(2020-01-01 10:00:00) @paused',
              '',
            ].join('\n')
          )
        );
        const first = select(todo, 'E2EBulkPaused').lineNumber;
        todo.selection = new vscode.Selection(first, 0, first + 2, 0);
        await command('syncPausedTags');
        assert(marker(text(todo, 'E2EBulkPaused')));
        assert(text(todo, 'E2EBulkPaused').includes('@id(@paused)'));
        assert(!marker(text(todo, 'E2EBulkActive')));
        assert(text(todo, 'E2EBulkActive').includes('@note(@paused)'));
        await expectStyle('E2EBulkPaused', (css) => css.color === 'rgb(229, 209, 69)');
        await expectStyle('E2EBulkActive', (css) => css.color === 'rgb(79, 193, 255)');
        await screenshot('bulk-paused-markers');
      }
    );
    await step(
      'refresh task styles in both split views of the same document after edits',
      async () => {
        await settings.update(
          'tags.styles',
          { splitA: { color: '#ff0000' }, splitB: { color: '#00ff00' } },
          vscode.ConfigurationTarget.Workspace
        );
        todo = await open('scenario.todo');
        const line = select(todo, 'E2ECosmetic');
        await todo.edit((edit) => edit.replace(line.range, '  ☐ E2ECosmetic @splitA'));
        const split = await vscode.window.showTextDocument(todo.document, {
          viewColumn: vscode.ViewColumn.Two,
          preview: false,
        });
        select(split, 'E2ECosmetic');
        const expectBoth = (color) =>
          waitFor(
            () => style('E2ECosmetic', true),
            (styles) => styles.length === 2 && styles.every((css) => css && css.color === color),
            `Both split views render ${color}`
          );
        await expectBoth('rgb(255, 0, 0)');
        const edited = select(split, 'E2ECosmetic');
        await split.edit((edit) => edit.replace(edited.range, '  ☐ E2ECosmetic @splitB'));
        await expectBoth('rgb(0, 255, 0)');
        await screenshot('split-editor-refresh');
        await split.edit((edit) =>
          edit.replace(select(split, 'E2ECosmetic').range, '  ☐ E2ECosmetic')
        );
        await waitFor(
          () => style('E2ECosmetic', true),
          (styles) =>
            styles.length === 2 && styles.every((css) => css && css.color !== 'rgb(0, 255, 0)'),
          'Both split views clear removed task styles'
        );
      }
    );
    await step(
      'clear and restore styles in both Markdown splits when support changes',
      async () => {
        markdown = await open('notes.md');
        const line = select(markdown, 'E2EMarkdown');
        await markdown.edit((edit) => edit.replace(line.range, '- [ ] E2ESplitMarkdown @splitA'));
        const split = await vscode.window.showTextDocument(markdown.document, {
          viewColumn: vscode.ViewColumn.Two,
          preview: false,
        });
        select(split, 'E2ESplitMarkdown');
        const expectBoth = (enabled) =>
          waitFor(
            () => style('E2ESplitMarkdown', true),
            (styles) =>
              styles.length === 2 &&
              styles.every((css) => css && (css.color === 'rgb(255, 0, 0)') === enabled),
            `Markdown split styles ${enabled ? 'enabled' : 'disabled'}`
          );
        await expectBoth(true);
        await settings.update('markdown.enabled', false, vscode.ConfigurationTarget.Workspace);
        await expectBoth(false);
        await settings.update('markdown.enabled', true, vscode.ConfigurationTarget.Workspace);
        await expectBoth(true);
        await screenshot('markdown-split-support');
      }
    );
    await step('preserve task styling and metadata through tag focus and clear focus', async () => {
      todo = await open('scenario.todo');
      const line = select(todo, 'E2ECosmetic');
      await todo.edit((edit) => edit.replace(line.range, '  ☐ E2ECosmetic @splitB'));
      const before = todo.document.getText();
      await vscode.commands.executeCommand('todo.focusTag', 'splitB');
      assert.strictEqual(todo.document.getText(), `(folded)\n${before}`);
      const targetLine = select(todo, 'E2ECosmetic').lineNumber;
      const ranges = await vscode.commands.executeCommand(
        'vscode.executeFoldingRangeProvider',
        todo.document.uri
      );
      assert(ranges.length > 0, 'Nonmatching tasks have focus folding ranges');
      assert(!ranges.some((range) => range.start < targetLine && targetLine <= range.end));
      await expectStyle('E2ECosmetic', (css) => css.color === 'rgb(0, 255, 0)');
      await command('clearFocus');
      assert.strictEqual(todo.document.getText(), `(folded)\n${before}`);
      await expectStyle('E2ECosmetic', (css) => css.color === 'rgb(0, 255, 0)');
      await screenshot('tag-focus-styling');
    });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack || String(error);
    if (renderer) await screenshot('failure').catch(() => undefined);
    throw error;
  } finally {
    if (renderer) renderer.close();
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  }
};
