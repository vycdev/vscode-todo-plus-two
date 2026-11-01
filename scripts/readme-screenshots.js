const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async () => {
  const artifacts = process.env.TODO_SCREENSHOT_DIR;
  const captured = [];
  const targets = await (
    await fetch(`http://127.0.0.1:${process.env.TODO_SCREENSHOT_PORT}/json/list`)
  ).json();
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('workbench'));
  assert(target, 'Real VS Code workbench available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const command = (name, ...args) => vscode.commands.executeCommand(name, ...args);
  const open = async (name, column = vscode.ViewColumn.One) => {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, name);
    return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), {
      preview: false,
      viewColumn: column,
    });
  };
  const shot = async (name) => {
    await command('notifications.clearAll');
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 850 });
    await pause(1200);
    const result = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(artifacts, `${name}.png`), Buffer.from(result.data, 'base64'));
    captured.push(`${name}.png`);
    console.log(`Captured ${name}`);
  };
  const rowPoint = async (text) =>
    evaluate(`(() => {
    const row = [...document.querySelectorAll('.monaco-list-row')].find(el => el.textContent.includes(${JSON.stringify(text)}));
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return { x: rect.x + Math.min(160, rect.width / 2), y: rect.y + rect.height / 2 };
  })()`);
  const mouse = async (point, button = 'left') => {
    assert(point, 'Target row exists');
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button,
      clickCount: 1,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button,
      clickCount: 1,
    });
  };
  const escape = async () => {
    for (const type of ['keyDown', 'keyUp'])
      await call('Input.dispatchKeyEvent', {
        type,
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      });
  };
  const drag = async (from, to) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...from,
      button: 'left',
      clickCount: 1,
    });
    for (let step = 1; step <= 10; step++) {
      await call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * step) / 10,
        y: from.y + ((to.y - from.y) * step) / 10,
        button: 'left',
        buttons: 1,
      });
      await pause(30);
    }
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...to,
      button: 'left',
      clickCount: 1,
    });
  };
  const resizePane = async (title, destinationY) => {
    const sash = await evaluate(`(() => {
      const pane = [...document.querySelectorAll('.pane')].find(el => el.querySelector('.pane-header')?.textContent.trim() === ${JSON.stringify(title)});
      if (!pane) return null;
      const edge = pane.getBoundingClientRect().bottom;
      const el = [...document.querySelectorAll('.monaco-sash.horizontal')].find(el => Math.abs(el.getBoundingClientRect().y - edge) < 8);
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (sash) await drag(sash, { x: sash.x, y: destinationY });
  };
  const report = {
    platform: process.platform,
    vscode: vscode.version,
    theme: vscode.workspace.getConfiguration('workbench').get('colorTheme'),
    capturedAt: new Date().toISOString(),
    bundleSha256: require('crypto')
      .createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '../out/extension.js')))
      .digest('hex'),
    captures: captured,
    status: 'capturing',
  };
  try {
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await vscode.extensions.getExtension('vycdev.vscode-todo-plus-two').activate();
    await command('workbench.action.closePanel');
    await command('workbench.action.closeAuxiliaryBar');
    await open('release.todo');
    await command('workbench.action.toggleSidebarVisibility');
    await shot('syntax');
    await command('workbench.view.extension.todo');
    await command('todo.views.1files.focus');
    await pause(2000);
    // Resize the sidebar through its real sash, without changing rendered content.
    const sash = await evaluate(`(() => {
      const edge = document.querySelector('.part.sidebar').getBoundingClientRect().right;
      const el = [...document.querySelectorAll('.monaco-sash.vertical')].find(el => Math.abs(el.getBoundingClientRect().x - edge) < 8);
      if (!el) return null;
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (sash) {
      await call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...sash,
        button: 'left',
        clickCount: 1,
      });
      await call('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 470,
        y: sash.y,
        button: 'left',
        buttons: 1,
      });
      await call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 470,
        y: sash.y,
        button: 'left',
        clickCount: 1,
      });
    }
    const embeddedHeader = await evaluate(`(() => {
      const el = [...document.querySelectorAll('.pane-header')].find(el => el.textContent.trim() === 'Embedded');
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 };
    })()`);
    if (embeddedHeader) await mouse(embeddedHeader);
    await resizePane('Files', 610);
    await open('notes.md');
    await command('todo.views.3due.focus');
    await pause(1200);
    await call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...(await rowPoint('Publish the API')),
    });
    await shot('activity_bar_views');
    await call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...(await rowPoint('Publish the API')),
    });
    await pause(500);
    const edit = await evaluate(`(() => {
      const el = [...document.querySelectorAll('.monaco-list-row .action-label')].find(el => (el.getAttribute('aria-label') || el.title || '').includes('Edit Task'));
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await mouse(edit);
    await shot('sidebar-actions');
    await escape();
    await vscode.workspace
      .getConfiguration('todo')
      .update('file.view.groupByTags', ['high', 'review'], vscode.ConfigurationTarget.Workspace);
    await command('todo.views.1files.focus');
    await pause(1500);
    await mouse({ x: 72, y: (await rowPoint('notes.md')).y });
    await open('release.todo');
    await shot('tag-groups');
    await command('todo.focusTag', 'high');
    await shot('tag-focus');
    await command('todo.clearFocus');
    await command('editor.foldAllMarkerRegions');
    await shot('regions');
    await command('editor.unfoldAll');
    await command('todo.views.2embedded.focus');
    await pause(2500);
    await command('vscode.moveViews', {
      viewIds: ['todo.views.2embedded'],
      destinationId: 'workbench.view.explorer',
    });
    await command('workbench.view.explorer');
    await resizePane('Release workspace', 350);
    await open('release.ts');
    const before = await rowPoint('Validate the release manifest');
    const after = await rowPoint('Check migration coverage');
    assert(before && after, 'Embedded siblings available for drag and drop');
    await drag(before, after);
    await pause(800);
    assert(
      (await rowPoint('Check migration coverage')).y <
        (await rowPoint('Validate the release manifest')).y,
      'Drag reordered actual Embedded rows'
    );
    await shot('embedded-ordering');
    await escape();
    await command('workbench.action.toggleSidebarVisibility');
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const timer = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'timer.todo');
    await vscode.workspace.fs.writeFile(
      timer,
      Buffer.from(
        'Release review:\n  ☐ Review documentation @est(30m)\n\nAlt+S starts a task. Alt+T pauses or resumes it.\nPaused time is excluded from elapsed work.\n'
      )
    );
    let editor = await open('timer.todo');
    editor.selection = new vscode.Selection(1, 4, 1, 4);
    await command('todo.toggleStart');
    await shot('timer-running');
    await command('todo.toggleTimer');
    await shot('timer-paused');
    if (process.platform === 'darwin') {
      await call('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 650,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await vscode.workspace
        .getConfiguration('editor')
        .update('wordWrap', 'on', vscode.ConfigurationTarget.Workspace);
      const { spawn } = require('child_process');
      const clipboard = spawn('/usr/bin/swift', [
        path.join(__dirname, 'clipboard-image.swift'),
        path.join(__dirname, '../resources/logo/logo.png'),
      ]);
      try {
        await new Promise((resolve, reject) => {
          clipboard.stdout.once('data', resolve);
          clipboard.once('error', reject);
          clipboard.once('exit', (code) => {
            if (code) reject(new Error(`Clipboard helper exited ${code}`));
          });
        });
        const attachment = vscode.Uri.joinPath(
          vscode.workspace.workspaceFolders[0].uri,
          'attachments.todo'
        );
        await vscode.workspace.fs.writeFile(
          attachment,
          Buffer.from('Design review:\n  ☐ Review the release icon\n    ')
        );
        editor = await open('attachments.todo');
        const end = editor.document.positionAt(editor.document.getText().length);
        editor.selection = new vscode.Selection(end, end);
        await command('workbench.action.focusActiveEditorGroup');
        await command('editor.action.pasteAs', { preferences: ['todo.image'] });
        for (
          let attempt = 0;
          attempt < 50 && !editor.document.getText().includes('file://');
          attempt++
        )
          await pause(100);
        const match = editor.document.getText().match(/<file:\/\/\.\/([^>]+)>/);
        assert(match, 'Native image paste created an attachment link');
        await command(
          'vscode.open',
          vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, match[1]),
          vscode.ViewColumn.Two
        );
        await shot('image-attachment');
      } finally {
        clipboard.stdin.end('\n');
        await new Promise((resolve) => clipboard.once('exit', resolve));
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error);
    await shot('failure');
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts, 'capture-report.json'), JSON.stringify(report, null, 2));
    socket.close();
  }
};
