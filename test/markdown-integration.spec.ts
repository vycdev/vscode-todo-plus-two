import { expect } from 'chai';
import * as path from 'path';
import * as _ from 'lodash';
import * as fs from 'fs';
import { getTimerState } from '../src/utils/timekeeping';

// Exercise real document/domain/command/statistics code against an in-memory
// editor. Only VS Code and IO/view boundaries are doubled.
const loadMarkdown = (initial: string, settings = {}) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const sourceRoot = path.resolve(__dirname, '../src') + path.sep;
  const previous = new Map(
    Object.keys(require.cache)
      .filter((key) => key.startsWith(sourceRoot))
      .map((key) => [key, require.cache[key]])
  );
  previous.forEach((_value, key) => delete require.cache[key]);
  const config = {};
  const properties = require('../package.json').contributes.configuration.properties;
  Object.keys(properties)
    .filter((key) => key.startsWith('todo.'))
    .forEach((key) => _.set(config, key.slice(5), _.cloneDeep(properties[key].default)));
  Object.keys(settings).forEach((key) => _.set(config, key, settings[key]));
  let content = initial;
  let archiveContent = '# Archive\n\nSaved note.\n';
  const messages: string[] = [];
  const decorationTypes: any[] = [];
  const transfers: { destination: string; content: string }[] = [];
  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    start: Position;
    end: Position;
    constructor(a, b, c?, d?) {
      this.start = typeof a === 'number' ? new Position(a, b) : a;
      this.end = typeof a === 'number' ? new Position(c, d) : b;
    }
  }
  const offsetAt = (position) => {
    const lines = content.split(/\r?\n/);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    return (
      lines.slice(0, position.line).reduce((count, line) => count + line.length + eol.length, 0) +
      position.character
    );
  };
  const uri = {
    fsPath: path.resolve('notes.md'),
    scheme: 'file',
    toString: () => 'file:///notes.md',
  };
  const document = {
    uri,
    languageId: 'markdown',
    version: 1,
    isClosed: false,
    fileName: uri.fsPath,
    eol: 1,
    get lineCount() {
      return content.split(/\r?\n/).length;
    },
    getText: (range?) =>
      range ? content.slice(offsetAt(range.start), offsetAt(range.end)) : content,
    lineAt: (lineNumber) => {
      const text = content.split(/\r?\n/)[lineNumber];
      return { lineNumber, text, range: new Range(lineNumber, 0, lineNumber, text.length) };
    },
    offsetAt,
    positionAt: (offset) => {
      const text = content.slice(0, offset);
      const lines = text.split(/\r?\n/);
      return new Position(lines.length - 1, lines[lines.length - 1].length);
    },
  };
  const editor = {
    document,
    options: { tabSize: 2, insertSpaces: true },
    selection: { active: new Position(0, 0) },
    selections: [{ start: new Position(0, 0), end: new Position(0, 0) }],
    setDecorations() {},
  };
  const select = (line: number) => {
    const pos = new Position(line, 0);
    editor.selection = { active: pos };
    editor.selections = [{ start: pos, end: pos }];
  };
  class WorkspaceEdit {
    entries = new Map();
    set(target, edits) {
      this.entries.set(target.toString(), edits);
    }
    replace(target, range, text) {
      this.set(target, [{ range, newText: text }]);
    }
  }
  const vscode = {
    commands: { executeCommand: async () => undefined },
    Position,
    Range,
    WorkspaceEdit,
    Selection: class {
      constructor(
        public start,
        public end
      ) {}
    },
    EndOfLine: { LF: 1, CRLF: 2 },
    TextEdit: {
      replace: (range, newText) => ({ range, newText }),
      delete: (range) => ({ range, newText: '' }),
      insert: (pos, newText) => ({ range: new Range(pos, pos), newText }),
    },
    Uri: { file: () => uri },
    window: {
      activeTextEditor: editor,
      visibleTextEditors: [editor],
      showInformationMessage: (text) => messages.push(text),
      showErrorMessage: (text) => messages.push(text),
      showInputBox: async (_options): Promise<string | undefined> => undefined,
      createTextEditorDecorationType: (options) => {
        const type = { options, dispose() {} };
        decorationTypes.push(type);
        return type;
      },
    },
    workspace: {
      textDocuments: [document],
      openTextDocument: async (filePath: string) =>
        vscode.workspace.textDocuments.find((candidate) => candidate.uri.fsPath === filePath),
      getConfiguration: () => ({ get: (key) => (key === 'todo' ? config : {}) }),
      applyEdit: async (edit) => {
        const edits = edit.entries.get(uri.toString()) || [];
        const changes = edits
          .map(({ range, newText }) => ({
            start: offsetAt(range.start),
            end: offsetAt(range.end),
            newText,
          }))
          .sort((a, b) => b.start - a.start || b.end - a.end);
        changes.forEach(
          ({ start, end, newText }) =>
            (content = content.slice(0, start) + newText + content.slice(end))
        );
        document.version++;
        return true;
      },
    },
    DecorationRangeBehavior: { OpenClosed: 0, ClosedOpen: 1, ClosedClosed: 2 },
    TreeItemCollapsibleState: { None: 0, Expanded: 1, Collapsed: 2 },
    TreeItem: class {
      constructor(
        public label,
        public collapsibleState
      ) {}
    },
    ThemeIcon: { File: 'file' },
    CompletionItem: class {
      constructor(
        public label,
        public kind?
      ) {}
    },
    CompletionItemKind: { Value: 1, Reference: 2 },
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
      dispose() {}
    },
  };
  const files = {
    getFilePaths: async () => [],
    getDocuments: async () => ({}),
    get: async () => ({}),
    filesData: {},
  };
  const utils: any = {
    log: { debug() {} },
    file: { open: async () => editor },
    files,
    context: {},
    folder: { getAllRootPaths: () => [], getRootPath: () => undefined },
    command: { get: () => '' },
    view: { getTypeIcon: () => undefined },
  };
  NodeModule._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (parent && parent.filename.startsWith(sourceRoot)) {
      if (['./utils', '../utils', '../../utils'].includes(request)) return { default: utils };
      const resolved = request.startsWith('.')
        ? path.resolve(path.dirname(parent.filename), request)
        : '';
      if (resolved === path.join(sourceRoot, 'utils/files')) return { default: files };
      if (resolved === path.join(sourceRoot, 'utils/archive-storage'))
        return {
          archiveToFile: async (destination, source, edits, merge) => {
            transfers.push({ destination, content: merge(archiveContent) });
            const edit = new WorkspaceEdit();
            edit.set(source.uri, edits);
            await vscode.workspace.applyEdit(edit);
          },
        };
      if (resolved === path.join(sourceRoot, 'utils/folder')) return { default: utils.folder };
      if (
        resolved === path.join(sourceRoot, 'views/embedded') ||
        resolved === path.join(sourceRoot, 'statusbars/timer')
      )
        return { default: {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    utils.regex = require('../src/utils/regex').default;
    utils.tags = require('../src/utils/tags').default;
    utils.editor = require('../src/utils/editor').default;
    utils.ast = require('../src/utils/ast').default;
    utils.time = require('../src/utils/time').default;
    utils.statistics = require('../src/utils/statistics').default;
    const Document = require('../src/todo/document').default;
    const decorator = require('../src/todo/decorators/document').default;
    const dependencyIndex = require('../src/utils/dependency_index').default;
    const getTodoDocuments = dependencyIndex.getTodoDocuments.bind(dependencyIndex);
    dependencyIndex.getTodoDocuments = async () => [document];
    const commands = require('../src/commands');
    const filesView = require('../src/views/files').default;
    const dueView = require('../src/views/due').Due;
    clearTimeout(dueView.rolloverTimer);
    const fileService = require('../src/utils/files').default;
    const completion = new (require('../src/providers/completion').default)();
    return {
      document,
      editor,
      select,
      config,
      messages,
      commands,
      dependencyIndex,
      getTodoDocuments,
      workspace: vscode.workspace,
      window: vscode.window,
      Document,
      decorator,
      taskStyles: require('../src/todo/decorators/task-tags'),
      decorationTypes,
      utils,
      filesView,
      dueView,
      fileService,
      completion,
      transfers,
      setArchiveContent: (text: string) => {
        archiveContent = text;
      },
      setText: (text) => {
        content = text;
        document.version++;
      },
    };
  } finally {
    NodeModule._load = originalLoad;
    Object.keys(require.cache)
      .filter((key) => key.startsWith(sourceRoot))
      .forEach((key) => delete require.cache[key]);
    previous.forEach((value, key) => (require.cache[key] = value));
  }
};

describe('Markdown task integration', () => {
  it('applies task-tag rules only to actual Markdown tasks and visible metadata', () => {
    const state = loadMarkdown(
      [
        'Prose @blocked',
        '- [ ] Literal \\@blocked <!-- @blocked --> `@blocked` @note(@blocked)',
        '- [ ] Work @blocked <!-- preserve this -->',
        '```',
        '- [ ] Example @blocked',
        '```',
      ].join('\n'),
      { 'tags.styles': { blocked: { color: '#ff0000', bold: true } } }
    );
    const todos = new state.Document(state.editor).getTodos();
    const decorations = state.taskStyles.getTaskTagDecorations(todos);
    expect(todos).to.have.length(2);
    expect(decorations).to.have.length(1);
    expect(decorations[0].type.options.color).to.equal('#ff0000');
    expect(decorations[0].ranges.every((range) => range.start.line === 2)).to.equal(true);
    const styled = decorations[0].ranges.map((range) => state.document.getText(range)).join('');
    expect(styled).to.include('Work');
    expect(styled).not.to.include('@blocked');
    expect(styled).not.to.include('preserve this');
    state.taskStyles.disposeTaskTagStyles();
  }).timeout(10000);

  it('pauses and resumes while preserving escaped tags and hidden timer examples', () => {
    const hidden = '<!-- @paused @toggle(2026-08-02 10:05:00) -->';
    const state = loadMarkdown(`- [ ] Work @started(2026-08-02 10:00:00) \\@paused ${hidden}`, {
      'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
    });
    const todo = new state.Document(state.editor).getTodos()[0];
    todo.toggleTimer(new Date(2026, 7, 2, 10, 30));
    expect(todo.lineNextText).to.include(`@toggle(2026-08-02 10:30:00) @paused ${hidden}`);
    expect(todo.lineNextText).to.include('\\@paused');
    todo.toggleTimer(new Date(2026, 7, 2, 11, 0));
    expect(todo.lineNextText).to.include(`@toggle(2026-08-02 11:00:00) ${hidden}`);
    expect(todo.lineNextText).to.include('\\@paused');
    expect(todo.lineNextText.replace(hidden, '').replace('\\@paused', '')).not.to.include(
      '@paused'
    );
  });

  it('repairs Markdown paused markers from visible timing history through the command', async () => {
    const state = loadMarkdown(
      '- [ ] Work @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) <!-- @paused -->',
      {
        'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
      }
    );
    state.select(0);
    await state.commands.syncPausedTags();
    expect(state.document.getText()).to.equal(
      '- [ ] Work @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @paused <!-- @paused -->'
    );
    state.setText(
      '- [ ] Work @started(2026-08-02 10:00:00) @note(@toggle(2026-08-02 10:30:00)) @paused'
    );
    await state.commands.syncPausedTags();
    expect(state.document.getText()).not.to.include('@paused');
    expect(state.document.getText()).to.include('@note(@toggle(2026-08-02 10:30:00))');
  });

  it('clears paused styling on completion and restores it when reopening paused history', async () => {
    const state = loadMarkdown(
      '- [ ] Work @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @paused',
      {
        'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
      }
    );
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.include('- [x] Work');
    expect(state.document.getText()).to.include('@lasted(30m)');
    expect(state.document.getText()).not.to.include('@paused');
    await state.commands.toggleDone();
    expect(state.document.getText()).to.include('- [ ] Work');
    expect(state.document.getText()).to.include('@paused');
    expect(new state.Document(state.editor).getTodosBox()).to.have.length(1);
  });

  it('keeps custom strikethrough tags cosmetic for completion and statistics', () => {
    const state = loadMarkdown('- [ ] Work @obsolete', {
      'tags.styles': { obsolete: { strikethrough: true } },
    });
    const doc = new state.Document(state.editor),
      items = state.decorator.getItems(doc),
      original = state.document.getText();
    const [decoration] = state.taskStyles.getTaskTagDecorations(doc.getTodos());
    expect(decoration.type.options.textDecoration).to.equal('line-through');
    expect(items.todosBox).to.have.length(1);
    expect(items.todosDone).to.have.length(0);
    expect(items.todosCancelled).to.have.length(0);
    state.utils.statistics.tokens.updateGlobal(items);
    expect(state.utils.statistics.tokens.global.pending).to.equal(1);
    expect(state.document.getText()).to.equal(original);
    state.taskStyles.disposeTaskTagStyles();
  });

  it('keeps Markdown task completion after an indented code example containing backticks', async () => {
    const line = '[ ] Ship @depends(r';
    const state = loadMarkdown('    ```python\n    literal code\n\n[ ] Setup @id(real)\n' + line);
    const items = await state.completion.provideCompletionItems(state.document, {
      line: 4,
      character: line.length,
    });
    expect(items.map((item) => item.label)).to.deep.equal(['real']);
  });
  it('keeps archived source unchanged when the original parent path is ambiguous', async () => {
    const state = loadMarkdown(
      '# Tasks\n- [ ] Parent @started(2026-01-01 10:00)\n- [ ] Parent @started(2026-02-01 10:00)\n  - [x] Child',
      { 'archive.type': 'InSameFile' }
    );
    await state.commands.archive();
    const original = state.document.getText();
    const child = new state.Document(state.editor)
      .getTodosDone()
      .find((todo) => todo.markdownNode.inArchive);
    state.select(child.lineNumber);
    await state.commands.unarchive();
    expect(state.document.getText()).to.equal(original);
    expect(state.messages[0]).to.include('Multiple Markdown parents');
  });

  it('restores a child to its original parent after completion cleans the parent tags', async () => {
    const state = loadMarkdown(
      '# Tasks\n- [ ] Parent @id(parent) @today @cleanup\n  - [x] Child\n- [ ] Parent @id(other)',
      {
        'archive.type': 'InSameFile',
        'timekeeping.finished.remove.tags': ['today', 'cleanup'],
      }
    );
    await state.commands.archive();
    state.select(1);
    await state.commands.toggleDone();
    expect(state.document.lineAt(1).text).to.include('@done(');
    expect(state.document.lineAt(1).text).not.to.include('@cleanup');
    const archived = new state.Document(state.editor)
      .getTodosDone()
      .find((todo) => todo.markdownNode.inArchive);
    state.select(archived.lineNumber);
    await state.commands.unarchive();
    const child = new state.Document(state.editor)
      .getTodosDone()
      .find((todo) => todo.markdownNode.title === 'Child');
    expect(child.markdownNode.parent).to.equal(1);
    expect(child.markdownNode.inArchive).to.equal(false);
    expect(new state.Document(state.editor).getTodos()).to.have.length(3);
  });

  it('limits commands and dependencies to selected headings inside list containers', async () => {
    const original =
      '- [ ] Parent @id(parent)\n  ## Tasks\n  - [ ] Inside @id(inside)\n- [ ] Outside @id(outside)';
    const state = loadMarkdown(original, {
      'markdown.scope': 'sections',
      'timekeeping.finished.enabled': false,
      autoCompleteParents: true,
    });
    const index = await state.dependencyIndex.get();
    expect(Object.keys(index.targets)).to.deep.equal(['inside']);
    for (const line of [0, 3]) {
      state.select(line);
      await state.commands.toggleDone();
      expect(state.document.getText()).to.equal(original);
    }
    state.select(2);
    await state.commands.toggleDone();
    expect(state.document.lineAt(2).text).to.equal('  - [x] Inside @id(inside)');
    expect(state.document.lineAt(0).text).to.equal(original.split('\n')[0]);
  });

  it('archives and unarchives tasks with a custom name ending in a heading marker', async () => {
    const state = loadMarkdown('[x] Done', {
      'archive.type': 'InSameFile',
      'archive.name': 'History #',
    });
    await state.commands.archive();
    expect(state.messages).to.deep.equal([]);
    const archived = new state.Document(state.editor).getTodosDone()[0];
    expect(archived.markdownNode.inArchive).to.equal(true);
    state.select(archived.lineNumber);
    await state.commands.unarchive();
    expect(new state.Document(state.editor).getTodosDone()[0].markdownNode.inArchive).to.equal(
      false
    );
  });

  it('preserves literal tag arguments during completion and archive cleanup', async () => {
    const literal = '@id(@today) @note(@today)';
    const state = loadMarkdown(`[ ] Work ${literal} @today`, {
      'timekeeping.finished.enabled': false,
      'archive.type': 'InSameFile',
    });
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.equal(`[x] Work ${literal}`);
    state.setText(`[x] Work ${literal} @today`);
    await state.commands.archive();
    expect(state.document.getText()).to.include(`[x] Work ${literal}`);
    expect(Object.keys((await state.dependencyIndex.get()).targets)).to.deep.equal(['@today']);
  });

  it('keeps tag-like text in arguments literal across status, dependencies, due dates and timers', async () => {
    const original =
      '[ ] Setup @id(@done) @note(@depends(missing)) @note(@due(2026-11-01)) @note(@started(2026-01-01 00:00))\n[ ] Ship @depends(@done)';
    const state = loadMarkdown(original, { 'timekeeping.finished.enabled': false });
    const doc = new state.Document(state.editor);
    expect(doc.getTodosBox()).to.have.length(2);
    expect(doc.getTodosDone()).to.have.length(0);
    expect(doc.getTagsDue()).to.have.length(0);
    expect(doc.getTodosBoxStarted()).to.have.length(0);
    const index = await state.dependencyIndex.get();
    expect(Object.keys(index.targets)).to.deep.equal(['@done']);
    expect(Object.keys(index.dependencies)).to.deep.equal(['@done']);
    state.utils.files.filesData = {
      'notes.md': { textEditor: state.document, relativePath: 'notes.md' },
    };
    const due = await state.dueView.getChildren();
    expect(due[0].label).to.include('No unfinished tasks');
    state.select(1);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.equal(original);
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.lineAt(0).text).to.equal(original.split('\n')[0].replace('[ ]', '[x]'));
    state.select(1);
    await state.commands.toggleDone();
    expect(state.document.lineAt(1).text).to.equal('[x] Ship @depends(@done)');
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.lineAt(0).text).to.equal(original.split('\n')[0]);
  });

  it('ignores timer controls written inside another tag argument', () => {
    const state = loadMarkdown(
      '[ ] Work @started(2026-01-01 00:00) @note(@toggle(2026-01-01 01:00))'
    );
    const todo = new state.Document(state.editor).getTodosBoxStarted()[0];
    const timer = getTimerState(
      todo.getTimekeepingText(),
      'YYYY-MM-DD HH:mm',
      new Date(2026, 0, 1, 2, 0)
    );
    expect(timer.active).to.equal(true);
    expect(timer.elapsedMilliseconds).to.equal(2 * 60 * 60 * 1000);
  });

  it('keeps CRLF line endings when every source line is archived in place', async () => {
    const state = loadMarkdown('[x] Done\r\n', { 'archive.type': 'InSameFile' });
    await state.commands.archive();
    const archived = state.document.getText();
    expect(archived).to.include('# Archive\r\n');
    expect(archived.replace(/\r\n/g, '')).not.to.include('\n');
    const todo = new state.Document(state.editor).getTodosDone()[0];
    state.select(todo.lineNumber);
    await state.commands.unarchive();
    expect(state.document.getText().replace(/\r\n/g, '')).not.to.include('\n');
    expect(new state.Document(state.editor).getTodosDone()[0].markdownNode.inArchive).to.equal(
      false
    );
  });

  it('refuses old tree rows when a note is reopened at the same document version', async () => {
    for (const action of ['viewEditTodo', 'viewToggleDone', 'viewToggleStart']) {
      const state = loadMarkdown('[ ] Original', { 'timekeeping.autoToggle': false });
      const items = await state.filesView.getChildren({
        obj: { filePath: state.document.uri.fsPath, textEditor: state.document },
      });
      const originalVersion = state.document.version;
      state.setText('[ ] Replacement');
      state.document.isClosed = true;
      state.editor.document = {
        ...state.document,
        isClosed: false,
        version: originalVersion,
      };
      await state.commands[action](items[0]);
      expect(state.editor.document.getText(), action).to.equal('[ ] Replacement');
      expect(state.messages[0], action).to.include('file changed');
    }
  });

  // Five isolated editor/module fixtures include cold TypeScript compilation.
  it('completes partially typed dependency IDs without changing escaped punctuation', async () => {
    const id = String.raw`path\*glob`;
    for (const prefix of [String.raw`path\*`, String.raw`path\*g`]) {
      const line = `[ ] Ship @depends(${prefix}`;
      const state = loadMarkdown(`[ ] Setup @id(${id})\n${line}`);
      const items = await state.completion.provideCompletionItems(state.document, {
        line: 1,
        character: line.length,
      });
      expect(items && items.map((item) => item.label)).to.deep.equal([id]);
      const item = items[0];
      const edit = {
        entries: new Map([
          [state.document.uri.toString(), [{ range: item.range, newText: item.insertText }]],
        ]),
      };
      await state.workspace.applyEdit(edit);
      expect(state.document.lineAt(1).text).to.equal(`[ ] Ship @depends(${id})`);
    }
    for (const hidden of [
      String.raw`[ ] Ship \@depends(path\*g`,
      String.raw`[ ] Ship ` + '`' + String.raw`@depends(path\*g` + '`',
      String.raw`[ ] Ship <!-- @depends(path\*g -->`,
    ]) {
      const state = loadMarkdown(`[ ] Setup @id(${id})\n${hidden}`);
      const position = hidden.indexOf('g') + 1;
      expect(
        await state.completion.provideCompletionItems(state.document, {
          line: 1,
          character: position,
        })
      ).to.equal(null);
    }
  }).timeout(10000);

  it('leaves list-fenced examples unchanged through task commands', async () => {
    const original = '- ```markdown\n  [ ] Example\n  ```\n- [ ] Real';
    const state = loadMarkdown(original, { 'timekeeping.finished.enabled': false });
    for (const line of [0, 1, 2]) {
      state.select(line);
      await state.commands.toggleBox();
      await state.commands.toggleDone();
      expect(state.document.getText()).to.equal(original);
    }
    state.select(3);
    await state.commands.toggleDone();
    expect(state.document.lineAt(3).text).to.equal('- [x] Real');
  });

  it('does not rewrite Setext headings or their underlines through Toggle Box', async () => {
    const original = 'Title\n=====\n\nTodos\n-----\n[ ] Work';
    const state = loadMarkdown(original);
    for (const line of [0, 1, 3, 4]) {
      state.select(line);
      await state.commands.toggleBox();
      expect(state.document.getText()).to.equal(original);
    }
  });

  it('keeps dependency IDs containing Markdown escape characters portable', async () => {
    const id = String.raw`path\*glob`;
    const state = loadMarkdown(`[ ] Setup @id(${id})\n[ ] Ship @depends(${id})`, {
      'timekeeping.finished.enabled': false,
    });
    const index = await state.dependencyIndex.get();
    expect(Object.keys(index.targets)).to.deep.equal([id]);
    expect(Object.keys(index.dependencies)).to.deep.equal([id]);
    state.select(1);
    await state.commands.toggleDone();
    expect(state.document.lineAt(1).text).to.equal(`[ ] Ship @depends(${id})`);
    state.select(0);
    await state.commands.toggleDone();
    state.select(1);
    await state.commands.toggleDone();
    expect(state.document.lineAt(1).text).to.equal(`[x] Ship @depends(${id})`);
  });
  it('keeps escaped metadata literal through dependency checks, completion and archive cleanup', async () => {
    const literals = '\\@done \\@id(hidden) \\@depends(missing) \\@today';
    const state = loadMarkdown(`[ ] Real ${literals}`, {
      'timekeeping.finished.enabled': false,
      'archive.type': 'InSameFile',
    });
    const index = await state.dependencyIndex.get();
    expect(Object.keys(index.targets)).to.deep.equal([]);
    expect(Object.keys(index.dependencies)).to.deep.equal([]);
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.equal(`[x] Real ${literals}`);
    await state.commands.archive();
    expect(state.document.getText()).to.include(`[x] Real ${literals}`);
  });

  it('hides only real tags from Markdown view labels', async () => {
    const state = loadMarkdown('[ ] Real \\@literal @work', { 'file.view.showTags': false });
    const items = await state.filesView.getChildren({
      obj: { filePath: state.document.uri.fsPath, textEditor: state.document },
    });
    expect(items[0].label).to.equal('Real \\@literal');
  });
  it('drops already-open excluded Markdown files from workspace dependency discovery', async () => {
    const state = loadMarkdown('[ ] Excluded @id(excluded)');
    const allowed = {
      ...state.document,
      uri: {
        ...state.document.uri,
        fsPath: path.resolve('allowed.md'),
        toString: () => 'file:///allowed.md',
      },
      getText: () => '[x] Allowed @id(allowed)',
      lineAt: (lineNumber) => ({
        ...state.document.lineAt(lineNumber),
        text: '[x] Allowed @id(allowed)',
      }),
    };
    state.workspace.textDocuments.push(allowed);
    state.utils.folder.getAllRootPaths = () => [process.cwd()];
    state.utils.files.getDocuments = async () => ({ [allowed.uri.fsPath]: allowed });
    state.dependencyIndex.getTodoDocuments = state.getTodoDocuments;
    expect(Object.keys((await state.dependencyIndex.get()).targets)).to.deep.equal(['allowed']);
    state.utils.files.getDocuments = async () => ({});
    expect(Object.keys((await state.dependencyIndex.get()).targets)).to.deep.equal([]);
    expect(Object.keys((await state.dependencyIndex.get(state.document)).targets)).to.deep.equal([
      'excluded',
    ]);
  });
  it('creates and restores checkboxes through the explicit Toggle Box command', async () => {
    const state = loadMarkdown('# Note\nSome prose\n  12. List item', {
      'timekeeping.created.enabled': false,
    });
    state.select(1);
    await state.commands.toggleBox();
    expect(state.document.lineAt(1).text).to.equal('- [ ] Some prose');
    state.select(2);
    await state.commands.toggleBox();
    expect(state.document.lineAt(2).text).to.equal('  12. [ ] List item');
    await state.commands.toggleBox();
    expect(state.document.lineAt(2).text).to.equal('  12. List item');
    await state.commands.toggleBox();
    expect(state.document.lineAt(2).text).to.equal('  12. [ ] List item');
  });

  it('does not create boxes in code, comments, quotes, front matter, or outside selected sections', async () => {
    const original =
      '---\ntitle: Note\n---\n# Note\nOutside\n```\nExample\n```\n<!--\nHidden\n-->\n> Quoted\n## Tasks\nInside';
    const state = loadMarkdown(original, {
      'markdown.scope': 'sections',
      'timekeeping.created.enabled': false,
    });
    for (const line of [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]) {
      state.select(line);
      await state.commands.toggleBox();
      expect(state.document.getText()).to.equal(original);
    }
    state.select(13);
    await state.commands.toggleBox();
    expect(state.document.lineAt(13).text).to.equal('- [ ] Inside');
  });

  it('keeps source tasks when a separate archive cannot expose the inserted tasks', async () => {
    const original = '- [x] Done';
    const state = loadMarkdown(original, { 'archive.type': 'InSeparateFile' });
    state.setArchiveContent('# Archive\n```\nUnfinished example');
    await state.commands.archive();
    expect(state.document.getText()).to.equal(original);
    expect(state.transfers).to.have.length(0);
    expect(state.messages[0]).to.include('Source tasks were kept');
  });
  it('ignores HTML-comment metadata across status, dependencies, estimates, due dates and completions', async () => {
    const hidden =
      '<!-- @done @id(hidden) @depends(missing) @est(8h) @due(2026-11-01) @started(2026-11-01 10:00) -->';
    const original = `[ ] Real ${hidden}`;
    const state = loadMarkdown(original);
    state.select(0);
    expect(new state.Document(state.editor).getTodosBox()).to.have.length(1);
    const index = await state.dependencyIndex.get();
    expect(Object.keys(index.targets)).to.deep.equal([]);
    expect(Object.keys(index.dependencies)).to.deep.equal([]);
    const items = state.decorator.getItems(new state.Document(state.editor));
    state.utils.statistics.tokens.disabled.global.est = false;
    state.utils.statistics.tokens.updateGlobal(items);
    expect(state.utils.statistics.tokens.global.estSeconds).to.equal(0);
    state.utils.files.filesData = {
      'notes.md': { textEditor: state.document, relativePath: 'notes.md' },
    };
    expect((await state.dueView.getChildren())[0].label).to.include('No unfinished');
    expect(
      await state.completion.provideCompletionItems(state.document, {
        line: 0,
        character: original.indexOf('@id') + 1,
      })
    ).to.equal(null);
    await state.commands.toggleTimer();
    expect(state.document.getText()).to.equal(original);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.include('[x] Real @done(');
    expect(state.document.getText()).to.include(hidden);
  });

  it('keeps hidden toggle examples out of timer elapsed time', () => {
    const state = loadMarkdown(
      '[ ] Work @started(2026-11-01 10:00:00) <!-- @toggle(2026-11-01 10:30:00) -->'
    );
    const todo = new state.Document(state.editor).getTodosBoxStarted()[0];
    const timer = getTimerState(
      todo.getTimekeepingText(),
      'YYYY-MM-DD HH:mm:ss',
      new Date(2026, 10, 1, 11)
    );
    expect(timer.active).to.equal(true);
    expect(timer.elapsedMilliseconds).to.equal(3600000);
  });

  it('preserves hidden comment payloads and spacing through completion and archive cleanup', async () => {
    const comment = '<!-- @today @done(example) -->';
    const state = loadMarkdown(`[ ] Work @today ${comment}`, {
      'timekeeping.finished.enabled': false,
      'archive.type': 'InSameFile',
    });
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.equal(`[x] Work ${comment}`);
    await state.commands.archive();
    expect(state.document.getText()).to.include(`[x] Work ${comment}`);
  });
  it('completes and reopens a native Markdown checkbox without changing its bullet or prose', async () => {
    const state = loadMarkdown(
      '# Notes\n\nKeep **this** prose.\n\n  * [ ] Ship @id(ship)\n    Details\n',
      { 'timekeeping.finished.enabled': false }
    );
    state.select(4);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.equal(
      '# Notes\n\nKeep **this** prose.\n\n  * [x] Ship @id(ship)\n    Details\n'
    );
    await state.commands.toggleDone();
    expect(state.document.lineAt(4).text).to.equal('  * [ ] Ship @id(ship)');
  });

  it('preserves cancelled status even when automatic finished tags are disabled', async () => {
    const state = loadMarkdown('[ ] Ship', { 'timekeeping.finished.enabled': false });
    state.select(0);
    await state.commands.toggleCancelled();
    expect(state.document.getText()).to.equal('[ ] Ship @cancelled');
    expect(new state.Document(state.editor).getTodosCancelled()).to.have.length(1);
    await state.commands.toggleCancelled();
    expect(state.document.getText()).to.equal('[ ] Ship');
  });

  it('can complete a cancelled checkbox when automatic finished tags are disabled', async () => {
    const state = loadMarkdown('- [ ] Ship @cancelled', { 'timekeeping.finished.enabled': false });
    state.select(0);
    await state.commands.toggleDone();
    expect(state.document.getText()).to.equal('- [x] Ship');
    expect(new state.Document(state.editor).getTodosDone()).to.have.length(1);
  });

  it('uses task-aware global and project statistics, including scoped tags and estimates', () => {
    const state = loadMarkdown(
      '# Note\n\nProse @est(9h)\n\n## Todos\n- [ ] Ship @est(2h) @work\n- [x] Finished @work\n\n```\n- [ ] Example @est(8h)\n```'
    );
    const items = state.decorator.getItems(new state.Document(state.editor));
    state.utils.statistics.tokens.updateDisabledAll();
    state.utils.statistics.tokens.disabled.global.est = false;
    state.utils.statistics.tokens.disabled.global.tagged = false;
    state.utils.statistics.tokens.updateGlobal(items);
    state.utils.statistics.tokens.updateProjects(state.document, items);
    const tokens = state.utils.statistics.tokens.global;
    expect([tokens.pending, tokens.done, tokens.estSeconds]).to.deep.equal([1, 1, 7200]);
    expect(tokens.getTagMetric('work')).to.equal(2);
    expect(state.utils.statistics.tokens.projects[4].pending).to.equal(1);
  });

  it('blocks completion on unfinished dependencies and indexes only real tasks', async () => {
    const state = loadMarkdown(
      '# Note\n[ ] Setup @id(setup)\n[ ] Ship @depends(setup)\n\n```\n[x] Fake @id(fake)\n```'
    );
    state.select(2);
    await state.commands.toggleDone();
    expect(state.document.lineAt(2).text).to.equal('[ ] Ship @depends(setup)');
    expect(state.messages[0]).to.include('unresolved dependencies');
    state.select(1);
    await state.commands.toggleDone();
    state.select(2);
    await state.commands.toggleDone();
    expect(state.document.lineAt(2).text).to.include('[x] Ship');
    expect(Object.keys((await state.dependencyIndex.get()).targets)).to.deep.equal(['setup']);
  });

  it('starts, pauses, and finishes a Markdown timer using the same timekeeping tags', async () => {
    const state = loadMarkdown('- [ ] Work', {
      'timekeeping.autoToggle': false,
      'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
      'timekeeping.elapsed.enabled': true,
    });
    state.select(0);
    await state.commands.toggleStart();
    expect(state.document.getText()).to.include('- [ ] Work @started(');
    await state.commands.toggleTimer();
    expect(state.document.getText()).to.include('@toggle(');
    await state.commands.toggleDone();
    expect(state.document.getText()).to.include('- [x] Work');
    expect(state.document.getText()).to.include('@lasted(');
  });

  it('automatically completes a Markdown parent after its last child', async () => {
    const state = loadMarkdown('# Tasks\n- [ ] Parent\n  - [x] First\n  - [ ] Last', {
      autoCompleteParents: true,
    });
    state.select(3);
    await state.commands.toggleDone();
    expect(state.document.lineAt(1).text).to.include('- [x] Parent');
  });

  it('archives and restores Markdown blocks through the public commands', async () => {
    const state = loadMarkdown('# Note\n\nKeep prose.\n\n## Todos\n- [x] Done\n  Attached note\n', {
      'archive.type': 'InSameFile',
    });
    await state.commands.archive();
    expect(state.document.getText()).to.include('# Archive');
    expect(state.document.getText()).to.include('Keep prose.');
    const archived = new state.Document(state.editor)
      .getTodosDone()
      .find((todo) => todo.markdownNode.inArchive);
    state.select(archived.lineNumber);
    await state.commands.unarchive();
    expect(
      new state.Document(state.editor).getTodosDone().some((todo) => !todo.markdownNode.inArchive)
    ).to.equal(true);
    expect(state.document.getText()).to.include('- [x] Done\n  Attached note');
  });

  it('routes separate Markdown archives through the shared transfer and cleans task tags only', async () => {
    for (const type of ['InSeparateFile', 'InMultiSeparateFile']) {
      const state = loadMarkdown(
        '# Todos\n- [x] Done @id(done) @today\n  Keep @today in this note\n',
        { 'archive.type': type }
      );
      await state.commands.archive();
      expect(state.transfers).to.have.length(1);
      expect(path.basename(state.transfers[0].destination)).to.equal(
        type === 'InSeparateFile' ? 'ARCHIVE.TODO.md' : 'ARCHIVE.notes.md'
      );
      expect(state.transfers[0].content).to.include('Saved note.');
      expect(state.transfers[0].content).to.include('- [x] Done @id(done)\n');
      expect(state.transfers[0].content).to.include('Keep @today in this note');
      expect(state.document.getText()).not.to.include('Done @id');
    }
  });

  it('keeps inline timekeeping examples intact when starting and stopping a real timer', async () => {
    const original = '- [ ] Work `@started(2026-01-01 00:00)`';
    const state = loadMarkdown(original, { 'timekeeping.autoToggle': false });
    state.select(0);
    await state.commands.toggleStart();
    expect(state.document.getText()).to.include(original + ' @started(');
    await state.commands.toggleStart();
    expect(state.document.getText()).to.equal(original);
  });

  it('refuses a stale Markdown tree action after the source document changes', async () => {
    const state = loadMarkdown('[ ] Original');
    const items = await state.filesView.getChildren({
      obj: { filePath: state.document.uri.fsPath, textEditor: state.document },
    });
    state.setText('[ ] Replacement');
    await state.commands.viewToggleDone(items[0]);
    expect(state.document.getText()).to.equal('[ ] Replacement');
    expect(state.messages[0]).to.include('file changed');
  });

  it('reparses unsaved same-length edits and honors Markdown enablement and section scope', () => {
    const state = loadMarkdown('## Todos\n[ ] Work\n## Notes\n[ ] Other', {
      'markdown.scope': 'sections',
    });
    expect(new state.Document(state.editor).getTodosBox()).to.have.length(1);
    state.setText('## Todos\n[x] Work\n## Notes\n[ ] Other');
    expect(new state.Document(state.editor).getTodosDone()).to.have.length(1);
    _.set(state.config, 'markdown.enabled', false);
    expect(new state.Document(state.editor).isSupported()).to.equal(false);
  });

  it('shows filtered Markdown groups and their matching descendants in the Files view', async () => {
    const state = loadMarkdown(
      '# Note\n## Sprint\n- [x] Finished parent\n  - [ ] Pending child\n## Other\n- [ ] Unrelated'
    );
    state.filesView.filter = 'Sprint';
    state.filesView.showFinished = false;
    const root = { obj: { filePath: state.document.uri.fsPath, textEditor: state.document } };
    const groups = await state.filesView.getChildren(root);
    expect(groups.map((item) => item.label)).to.deep.equal(['Note']);
    const work = await state.filesView.getChildren(groups[0]);
    expect(work.map((item) => item.label)).to.deep.equal(['Sprint']);
    const parent = await state.filesView.getChildren(work[0]);
    expect(parent.map((item) => item.label)).to.deep.equal(['Finished parent']);
    expect((await state.filesView.getChildren(parent[0])).map((item) => item.label)).to.deep.equal([
      'Pending child',
    ]);
  });

  it('includes pending Markdown due dates and counts only real pending tasks in the badge', async () => {
    const state = loadMarkdown(
      '# Tasks\n- [ ] Due @due(2026-10-31)\n- [x] Done @due(2026-10-31)\n```\n- [ ] Example @due(2026-10-31)\n```\n# Archive\n[ ] Archived'
    );
    state.utils.files.filesData = {
      'notes.md': { textEditor: state.document, relativePath: 'notes.md' },
    };
    const groups = await state.dueView.getChildren();
    expect(groups).to.have.length(1);
    expect(groups[0].obj).to.have.length(1);
    expect(groups[0].obj[0].obj.lineNr).to.equal(1);
    state.filesView.treeView = { badge: undefined };
    state.filesView.updateActivityBarBadge();
    expect(state.filesView.treeView.badge.value).to.equal(1);
  });

  it('reuses unchanged Markdown due scans across sidebar refreshes', async () => {
    const state = loadMarkdown('# Tasks\n- [ ] Due @due(2026-10-31)\n- [x] Done @due(2026-10-31)');
    state.utils.files.filesData = {
      'notes.md': { textEditor: state.document, relativePath: 'notes.md' },
    };
    let reads = 0;
    const lineAt = state.document.lineAt;
    state.document.lineAt = (line) => {
      reads++;
      return lineAt(line);
    };

    const first = await state.dueView.getChildren();
    expect(first[0].obj[0].obj.lineNr).to.equal(1);
    reads = 0;
    const unchanged = await state.dueView.getChildren();
    expect(unchanged[0].obj[0].obj.lineNr).to.equal(1);
    expect(reads).to.equal(1); // Only the visible due task needs its live line.

    state.setText('# Tasks\n- [ ] New @due(2026-10-31)\n- [ ] Another @due(2026-10-31)');
    reads = 0;
    const edited = await state.dueView.getChildren();
    expect(edited[0].obj.map((todo) => todo.obj.lineNr)).to.deep.equal([1, 2]);
    expect(reads).to.be.greaterThan(2); // The edited document is rescanned.

    _.set(state.config, 'markdown.scope', 'sections');
    _.set(state.config, 'markdown.sections', ['Other']);
    reads = 0;
    expect((await state.dueView.getChildren())[0].label).to.equal(
      'No unfinished tasks with due dates found'
    );
    expect(reads).to.be.greaterThan(0); // Parser settings also invalidate the cache.
  });

  it('rescans relative due expressions even when the document is unchanged', async () => {
    const state = loadMarkdown('- [ ] Soon @due(tomorrow)');
    state.utils.files.filesData = {
      'notes.md': { textEditor: state.document, relativePath: 'notes.md' },
    };
    let reads = 0;
    const lineAt = state.document.lineAt;
    state.document.lineAt = (line) => {
      reads++;
      return lineAt(line);
    };
    const first = await state.dueView.getChildren();
    expect(first[0].obj).to.have.length(1);
    reads = 0;
    await state.dueView.getChildren();
    expect(reads).to.be.greaterThan(1);
  });

  it('offers dependency completions on tasks and leaves Markdown prose and examples alone', async () => {
    const state = loadMarkdown(
      '[ ] Setup @id(setup)\n[ ] Ship @depends()\n\nProse @now\n```\n[ ] Example @now\n```'
    );
    const items = await state.completion.provideCompletionItems(state.document, {
      line: 1,
      character: 18,
    });
    expect(items.map((item) => item.label)).to.deep.equal(['setup']);
    expect(
      await state.completion.provideCompletionItems(state.document, { line: 3, character: 10 })
    ).to.equal(null);
    expect(
      await state.completion.provideCompletionItems(state.document, { line: 5, character: 16 })
    ).to.equal(null);
  });

  it('discovers Markdown notes alongside Todo files using the shared excludes and setting', async () => {
    const state = loadMarkdown('[ ] Note');
    const fixture = fs.mkdtempSync(path.join(process.cwd(), '.markdown-discovery-'));
    const note = path.join(fixture, 'notes.md');
    const todo = path.join(fixture, 'tasks.todo');
    const excluded = path.join(fixture, 'ignored.md');
    [note, todo, excluded].forEach((file) => fs.writeFileSync(file, ''));
    _.set(state.config, 'file.exclude', ['**/ignored.md']);
    try {
      const files = await state.fileService.getFilePaths([fixture]);
      expect(files).to.have.members([note, todo].map((file) => file.replace(/\\/g, '/')));
      _.set(state.config, 'markdown.enabled', false);
      expect(await state.fileService.getFilePaths([fixture])).to.deep.equal([
        todo.replace(/\\/g, '/'),
      ]);
    } finally {
      [note, todo, excluded].forEach((file) => fs.unlinkSync(file));
      fs.rmdirSync(fixture);
    }
  });
});

describe('Sidebar task editing', () => {
  const getTasks = async (state) => {
    const visit = async (item) => {
      const tasks = [];
      for (const child of await state.filesView.getChildren(item)) {
        if (child.contextValue === 'todo') tasks.push(child);
        if (child.collapsibleState) tasks.push(...(await visit(child)));
      }
      return tasks;
    };
    return visit({ obj: { filePath: state.document.uri.fsPath, textEditor: state.document } });
  };

  const keepEditorHidden = (state) => {
    state.window.activeTextEditor = undefined;
    state.window.visibleTextEditors = [];
    state.utils.file.open = async () => {
      throw new Error('Sidebar actions must not reveal the source editor');
    };
  };

  for (const language of ['todo', 'markdown']) {
    it(`preserves a configured multi-character ${language} marker when editing`, async () => {
      const initial = 'Project:\n  [TODO] Task @id(task)';
      const state = loadMarkdown(initial, { 'symbols.box': '[TODO]' });
      state.document.languageId = language;
      const [task] = await getTasks(state);
      keepEditorHidden(state);
      state.window.showInputBox = async (options) => {
        expect(options.value).to.equal('Task @id(task)');
        return 'Changed @id(task)';
      };

      await state.commands.viewEditTodo(task);

      expect(state.document.getText()).to.equal(initial.replace('Task @', 'Changed @'));
    });

    it(`rejects stale ${language} rows before editing text or status`, async () => {
      const state = loadMarkdown('☐ Original');
      state.document.languageId = language;
      const [task] = await getTasks(state);
      keepEditorHidden(state);
      state.setText('☐ Replacement');
      state.window.showInputBox = async () => {
        throw new Error('Stale tasks must not open an edit prompt');
      };

      for (const action of [
        'viewEditTodo',
        'viewToggleBox',
        'viewToggleDone',
        'viewToggleCancelled',
        'viewToggleStart',
      ])
        await state.commands[action](task);

      expect(state.document.getText()).to.equal('☐ Replacement');
      expect(state.messages).to.have.length(5);
      expect(state.messages.every((message) => message.includes('file changed'))).to.equal(true);
    });

    it(`edits hidden ${language} tasks using raw text while preserving tags, markers and CRLF`, async () => {
      const initial =
        language === 'todo'
          ? 'Project:\r\n\t☐   Old @id(ship) @today\r\n'
          : '# Project\r\n  7. [X]   Old @id(ship) @today\r\n';
      const state = loadMarkdown(initial, { 'file.view.showTags': false });
      state.document.languageId = language;
      const task = (await getTasks(state))[0];
      expect(task.label).not.to.include('@id');
      keepEditorHidden(state);
      const selections = state.editor.selections;
      state.window.showInputBox = async (options) => {
        expect(options.value).to.equal('Old @id(ship) @today');
        expect(options.validateInput('')).to.be.a('string');
        expect(options.validateInput('  ')).to.be.a('string');
        expect(options.validateInput('First\nSecond')).to.be.a('string');
        expect(options.validateInput('New @id(ship) @today')).to.equal(undefined);
        return 'New @id(ship) @today';
      };

      await state.commands.viewEditTodo(task);

      expect(state.document.getText()).to.equal(initial.replace('Old', 'New'));
      expect(state.window.activeTextEditor).to.equal(undefined);
      expect(state.editor.selections).to.equal(selections);
      expect(state.messages).to.deep.equal([]);
    });

    it(`keeps ${language} completion and parent completion working without an editor`, async () => {
      const state = loadMarkdown(
        language === 'todo'
          ? '☐ Parent\n  ☐ Child @id(child)'
          : '- [ ] Parent\n  - [ ] Child @id(child)',
        { autoCompleteParents: true, 'timekeeping.finished.enabled': false }
      );
      state.document.languageId = language;
      const child = (await getTasks(state)).find((task) => task.obj.lineNr === 1);
      keepEditorHidden(state);

      await state.commands.viewToggleDone(child);

      const completed = new state.Document(state.document).getTodosDone();
      expect(completed.map((todo) => todo.lineNumber)).to.deep.equal([0, 1]);
      const refreshed = (await getTasks(state)).find((task) => task.obj.lineNr === 1);
      await state.commands.viewToggleDone(refreshed);
      expect(new state.Document(state.document).getTodoAt(1).isBox()).to.equal(true);
      expect(state.document.lineAt(1).text).to.include('@id(child)');
      expect(state.window.activeTextEditor).to.equal(undefined);
    });

    it(`blocks ${language} sidebar completion on unfinished dependencies`, async () => {
      const initial = '☐ Setup @id(setup)\n☐ Ship @depends(setup)';
      const state = loadMarkdown(initial);
      state.document.languageId = language;
      const ship = (await getTasks(state)).find((task) => task.obj.lineNr === 1);
      keepEditorHidden(state);

      await state.commands.viewToggleDone(ship);

      expect(state.document.getText()).to.equal(initial);
      expect(state.messages[0]).to.include('unresolved dependencies (setup)');
    });

    it(`edits and regroups duplicated ${language} task rows by their source`, async () => {
      const state = loadMarkdown('☐ First\n☐ Target @low @high @id(target)', {
        'file.view.groupByTags': ['low', 'high'],
        'file.view.showTags': false,
      });
      state.document.languageId = language;
      const tasks = await getTasks(state);
      expect(tasks.filter((task) => task.obj.lineNr === 1)).to.have.length(2);
      keepEditorHidden(state);
      state.window.showInputBox = async () => 'Renamed @high @id(target)';

      await state.commands.viewEditTodo(tasks[0]);

      expect(state.document.lineAt(0).text).to.equal('☐ First');
      expect(state.document.lineAt(1).text).to.equal('☐ Renamed @high @id(target)');
      expect((await getTasks(state)).filter((task) => task.obj.lineNr === 1)).to.have.length(1);
      await state.commands.viewToggleDone(tasks[1]);
      expect(state.document.lineAt(1).text).to.equal('☐ Renamed @high @id(target)');
      expect(state.messages[0]).to.include('file changed');
    });

    it(`edits ${language} Due tasks and removes them from their previous due group`, async () => {
      const state = loadMarkdown('☐ Task @due(2020-01-01)');
      state.document.languageId = language;
      state.utils.files.filesData = {
        [state.document.uri.fsPath]: { textEditor: state.document },
      };
      const groups = await state.dueView.getChildren();
      const [task] = await state.dueView.getChildren(groups[0]);
      keepEditorHidden(state);
      state.window.showInputBox = async () => 'Renamed';

      await state.commands.viewEditTodo(task);

      expect(state.document.getText()).to.equal('☐ Renamed');
      expect((await state.dueView.getChildren())[0].label).to.equal(
        'No unfinished tasks with due dates found'
      );
    });
  }

  for (const value of [undefined, 'Task @id(task)', '', '  ', 'First\nSecond', 'First\rSecond']) {
    it(`keeps the source unchanged for a cancelled, unchanged or invalid edit: ${JSON.stringify(value)}`, async () => {
      const initial = '☐ Task @id(task)';
      const state = loadMarkdown(initial);
      const [task] = await getTasks(state);
      keepEditorHidden(state);
      state.window.showInputBox = async () => value;

      await state.commands.viewEditTodo(task);

      expect(state.document.getText()).to.equal(initial);
      expect(state.document.version).to.equal(1);
    });
  }

  it('does not overwrite text changed while the edit prompt was open', async () => {
    const state = loadMarkdown('☐ Original @id(task)');
    const [task] = await getTasks(state);
    keepEditorHidden(state);
    state.window.showInputBox = async () => {
      state.setText('☐ Newer source @id(task)');
      return 'Stale input @id(task)';
    };

    await state.commands.viewEditTodo(task);

    expect(state.document.getText()).to.equal('☐ Newer source @id(task)');
    expect(state.messages[0]).to.include('file changed');
  });

  for (const setting of ['scope', 'sections']) {
    it(`rejects a prompt edit when Markdown ${setting} settings exclude the task`, async () => {
      const initial = '# Tasks\n- [ ] Original @id(task)';
      const state = loadMarkdown(initial, {
        'markdown.scope': setting === 'scope' ? 'all' : 'sections',
        'markdown.sections': ['Tasks'],
      });
      const [task] = await getTasks(state);
      keepEditorHidden(state);
      state.window.showInputBox = async () => {
        _.set(state.config, 'markdown.scope', 'sections');
        _.set(state.config, 'markdown.sections', ['Other']);
        return 'Edited outside the task sections @id(task)';
      };

      await state.commands.viewEditTodo(task);

      expect(new state.Document(state.document).getTodos()).to.have.length(0);
      expect(state.document.getText()).to.equal(initial);
      expect(state.document.version).to.equal(1);
      expect(state.messages[0]).to.include('no longer included');
    });
  }

  it('ignores fenced examples when completing a hidden Todo parent', async () => {
    const state = loadMarkdown('☐ Parent\n  ☐ Child\n  ```text\n  ☐ Example task\n  ```', {
      autoCompleteParents: true,
      'timekeeping.finished.enabled': false,
    });
    state.document.languageId = 'todo';
    const child = (await getTasks(state)).find((task) => task.obj.lineNr === 1);
    keepEditorHidden(state);

    await state.commands.viewToggleDone(child);

    expect(
      new state.Document(state.document).getTodosDone().map((todo) => todo.lineNumber)
    ).to.deep.equal([0, 1]);
    expect(state.document.lineAt(3).text).to.equal('  ☐ Example task');
  });

  it('does not complete a hidden task changed during an asynchronous dependency check', async () => {
    const state = loadMarkdown('☐ Ready @id(ready)\n☐ Ship @depends(ready)');
    const task = (await getTasks(state))[1];
    keepEditorHidden(state);
    state.dependencyIndex.get = async () => {
      state.setText('☐ Ready @id(ready)\n☐ Replacement');
      return { targets: { ready: [{}] }, dependencies: {} };
    };
    state.dependencyIndex.isFinished = () => true;

    await state.commands.viewToggleDone(task);

    expect(state.document.lineAt(1).text).to.equal('☐ Replacement');
    expect(state.messages[0]).to.include('file changed');
  });

  it('reports a rejected workspace edit without changing the source', async () => {
    const state = loadMarkdown('☐ Original');
    const [task] = await getTasks(state);
    keepEditorHidden(state);
    state.window.showInputBox = async () => 'Replacement';
    state.workspace.applyEdit = async () => false;

    await state.commands.viewEditTodo(task);

    expect(state.document.getText()).to.equal('☐ Original');
    expect(state.messages).to.deep.equal(['Unable to edit the selected task']);
  });

  it('reports an unavailable source file without opening the edit prompt', async () => {
    const state = loadMarkdown('☐ Original');
    const [task] = await getTasks(state);
    state.workspace.openTextDocument = async () => {
      throw new Error('File unavailable');
    };
    state.window.showInputBox = async () => {
      throw new Error('The prompt must not open');
    };

    await state.commands.viewEditTodo(task);

    expect(state.document.getText()).to.equal('☐ Original');
    expect(state.messages).to.deep.equal(['Unable to open the selected task: File unavailable']);
  });

  it('refreshes both sidebars after rejecting a disposed background document', async () => {
    const state = loadMarkdown('☐ Original');
    const [task] = await getTasks(state);
    const refreshes = [];
    state.filesView.refresh = () => refreshes.push('files');
    state.dueView.refresh = () => refreshes.push('due');
    state.document.isClosed = true;
    const reopened = { ...state.document, isClosed: false };
    state.workspace.openTextDocument = async () => reopened;
    let prompts = 0;
    state.window.showInputBox = async () => {
      prompts++;
      return undefined;
    };

    await state.commands.viewEditTodo(task);

    expect(prompts).to.equal(0);
    expect(state.messages[0]).to.include('file changed');
    expect(refreshes).to.deep.equal(['files', 'due']);
    // A row rebuilt from the reopened buffer can be edited on the next attempt.
    await state.commands.viewEditTodo({ obj: { ...task.obj, textEditor: reopened } });
    expect(prompts).to.equal(1);
  });
});

describe('Files view tag grouping', () => {
  const root = (state) => ({
    obj: { filePath: state.document.uri.fsPath, textEditor: state.document },
  });

  it('preserves the original hierarchy when tag grouping is disabled', async () => {
    for (const language of ['todo', 'markdown']) {
      const state = loadMarkdown(
        language === 'todo' ? 'Project:\n  ☐ Work @low' : '# Project\n[ ] Work @low'
      );
      state.document.languageId = language;
      const items = await state.filesView.getChildren(root(state));
      expect(items.map((item) => item.label)).to.deep.equal([
        language === 'todo' ? 'Project:' : 'Project',
      ]);
      const children = await state.filesView.getChildren(items[0]);
      expect(children[0].label).to.include('Work @low');
    }
  });

  it('groups Todo tasks across nested projects, retaining source coordinates and context', async () => {
    const original = [
      'Work:',
      '  Doing:',
      '    ☐ First @low @id(first)',
      '    ☐ Both @low @tag-a',
      '  Todo:',
      '    - [ ] Third @high',
      '  Done:',
      '    ✔ Fourth @high @tag-a',
      '    ✘ Fifth @low',
      '  A note @low',
      '  ☐ Parent',
      '    ☐ Child @lowish',
    ].join('\n');
    const state = loadMarkdown(original, { 'file.view.groupByTags': ['low', 'high', 'tag-a'] });
    state.document.languageId = 'todo';
    const groups = await state.filesView.getChildren(root(state));
    expect(groups.map((group) => group.label)).to.deep.equal([
      '@low (3)',
      '@high (2)',
      '@tag-a (2)',
      'Other (2)',
    ]);
    const low = await state.filesView.getChildren(groups[0]);
    expect(low.map((item) => item.obj.lineNr)).to.deep.equal([2, 3, 8]);
    expect(low[0].description).to.equal('Work: / Doing:');
    expect(low[0].obj.filePath).to.equal(state.document.uri.fsPath);
    expect(low[0].obj.textEditor).to.equal(state.document);
    expect(low[0].obj.documentVersion).to.equal(state.document.version);
    expect(low[0].contextValue).to.equal('todo');
    expect(low[0].command).to.deep.equal({
      title: 'Reveal',
      command: 'todo.viewRevealTodo',
      arguments: [low[0]],
    });
    expect(low[0].tooltip).to.include('Doing:');
    expect(state.document.getText()).to.equal(original);
  });

  it('uses scoped Markdown tasks and ignores code, comments, inherited tags, and tag arguments', async () => {
    const state = loadMarkdown(
      [
        '# Todos @low',
        '- [ ] Parent @high',
        '  - [ ] Child @note(@low) \\@low `@low` <!-- @low -->',
        '  - [x] Finished @low(review)',
        '```',
        '- [ ] Example @low',
        '```',
        '# Notes',
        '- [ ] Outside @low',
      ].join('\n'),
      {
        'file.view.groupByTags': ['@low', 'high'],
        'markdown.scope': 'sections',
        'markdown.sections': ['Todos @low'],
      }
    );
    const groups = await state.filesView.getChildren(root(state));
    expect(groups.map((group) => group.label)).to.deep.equal([
      '@low (1)',
      '@high (1)',
      'Other (1)',
    ]);
    const low = await state.filesView.getChildren(groups[0]);
    expect(low[0].label).to.equal('Finished @low(review)');
    expect(low[0].description).to.equal('✓ · Todos @low / Parent @high');
    const other = await state.filesView.getChildren(groups[2]);
    expect(other[0].obj.lineNr).to.equal(2);
  });

  it('applies visibility and project/path filters before calculating groups and counts', async () => {
    for (const language of ['todo', 'markdown']) {
      const state = loadMarkdown(
        [
          language === 'todo' ? 'Sprint:' : '# Sprint',
          '  ☐ Pending @low',
          '  ✔ Done @low',
          '  ✘ Cancelled @low',
          language === 'todo' ? 'Other:' : '# Other',
          '  ☐ Unrelated @low',
        ].join('\n'),
        { 'file.view.groupByTags': ['low'], 'file.view.showTags': false }
      );
      state.document.languageId = language;
      state.filesView.filter = 'Sprint';
      state.filesView.showFinished = false;
      const groups = await state.filesView.getChildren(root(state));
      expect(groups.map((group) => group.label)).to.deep.equal(['@low (1)']);
      const tasks = await state.filesView.getChildren(groups[0]);
      expect(tasks[0].label).to.equal(language === 'todo' ? '☐ Pending' : 'Pending');
      state.filesView.filter = state.document.uri.fsPath;
      expect((await state.filesView.getChildren(root(state)))[0].label).to.equal('@low (2)');
      state.filesView.filter = 'missing';
      expect((await state.filesView.getChildren(root(state)))[0].label).to.equal(
        'No matching tasks found'
      );
    }
  });

  it('regroups same-length unsaved edits and keeps archive tasks governed by finished visibility', async () => {
    const state = loadMarkdown('☐ Work @low\nArchive:\n  ✔ Saved @low', {
      'file.view.groupByTags': ['low', 'now'],
    });
    state.document.languageId = 'todo';
    expect((await state.filesView.getChildren(root(state)))[0].label).to.equal('@low (2)');
    state.setText('☐ Work @now\nArchive:\n  ✔ Saved @low');
    expect(
      (await state.filesView.getChildren(root(state))).map((group) => group.label)
    ).to.deep.equal(['@low (1)', '@now (1)']);
    state.filesView.showFinished = false;
    expect((await state.filesView.getChildren(root(state)))[0].label).to.equal('@now (1)');
    state.setText('✔ Work @now');
    expect((await state.filesView.getChildren(root(state)))[0].label).to.equal(
      'No unfinished tasks found'
    );
  });

  it('preserves file and workspace boundaries', async () => {
    const state = loadMarkdown('[ ] Task @low', { 'file.view.groupByTags': ['low'] });
    state.utils.view.getURI = ({ filePath, relativePath }) => ({
      fsPath: filePath,
      label: relativePath,
    });
    state.utils.files.get = async () => ({
      Alpha: {
        '/alpha/tasks.md': {
          filePath: '/alpha/tasks.md',
          relativePath: 'tasks.md',
          textEditor: state.document,
        },
      },
      Beta: {
        '/beta/tasks.md': {
          filePath: '/beta/tasks.md',
          relativePath: 'tasks.md',
          textEditor: state.document,
        },
      },
    });
    const roots = await state.filesView.getChildren();
    expect(roots.map((item) => item.label)).to.deep.equal(['Alpha', 'Beta']);
    for (const [index, workspace] of roots.entries()) {
      const files = await state.filesView.getChildren(workspace);
      const groups = await state.filesView.getChildren(files[0]);
      expect(groups[0].label).to.equal('@low (1)');
      const tasks = await state.filesView.getChildren(groups[0]);
      expect(tasks[0].obj.filePath).to.equal(index ? '/beta/tasks.md' : '/alpha/tasks.md');
    }
  });

  it('uses configured Todo symbols and restores the hierarchy after a settings refresh', async () => {
    const state = loadMarkdown('Project:\n  > Work @low', {
      'file.view.groupByTags': ['low'],
      'symbols.box': '>',
    });
    state.document.languageId = 'todo';
    expect((await state.filesView.getChildren(root(state)))[0].label).to.equal('@low (1)');
    _.set(state.config, 'file.view.groupByTags', []);
    state.filesView.refresh();
    expect((await state.filesView.getChildren(root(state)))[0].label).to.equal('Project:');
  });

  it('keeps dependency validation on grouped task actions', async () => {
    const state = loadMarkdown('☐ Prerequisite @id(dep)\n☐ Ship @low @depends(dep)', {
      'file.view.groupByTags': ['low'],
    });
    state.utils.file.open = async (_path, _preview, lineNr) => {
      state.select(lineNr);
      return state.editor;
    };
    const groups = await state.filesView.getChildren(root(state));
    const tasks = await state.filesView.getChildren(groups[0]);
    await state.commands.viewToggleDone(tasks[0]);
    expect(state.document.lineAt(1).text).to.equal('☐ Ship @low @depends(dep)');
    expect(state.messages[0]).to.include('unresolved dependencies');
  });

  it('keeps nested tasks when the filter matches a finished parent task', async () => {
    for (const language of ['todo', 'markdown']) {
      const state = loadMarkdown(
        language === 'todo'
          ? 'Project:\n  ✔ Release\n    ☐ Child @low'
          : '# Project\n- [x] Release\n  - [ ] Child @low',
        { 'file.view.groupByTags': ['low'], 'file.view.showFinished': false }
      );
      state.document.languageId = language;
      state.filesView.filter = 'Release';
      const groups = await state.filesView.getChildren(root(state));
      expect(groups.map((group) => group.label)).to.deep.equal(['@low (1)']);
      const tasks = await state.filesView.getChildren(groups[0]);
      expect(tasks[0].label).to.include('Child @low');
      expect(tasks[0].description).to.equal(
        language === 'todo' ? 'Project: / ✔ Release' : 'Project / Release'
      );
    }
  });

  it('preserves escaped Markdown tags in grouped source paths when tags are hidden', async () => {
    const state = loadMarkdown('# Project \\@literal @real\n- [ ] Task @low', {
      'file.view.groupByTags': ['low'],
      'file.view.showTags': false,
    });
    const groups = await state.filesView.getChildren(root(state));
    const tasks = await state.filesView.getChildren(groups[0]);
    expect(tasks[0].description).to.equal('Project \\@literal');
  });

  it('keeps grouped actions on the source task and refuses stale rows', async () => {
    for (const language of ['todo', 'markdown']) {
      const state = loadMarkdown('☐ First\n☐ Target @low @id(target)', {
        'file.view.groupByTags': ['low'],
        'timekeeping.finished.enabled': false,
      });
      state.document.languageId = language;
      state.utils.file.open = async (_path, _preview, lineNr) => {
        state.select(lineNr);
        return state.editor;
      };
      const groups = await state.filesView.getChildren(root(state));
      const tasks = await state.filesView.getChildren(groups[0]);
      await state.commands.viewToggleDone(tasks[0]);
      expect(state.document.lineAt(0).text).to.equal('☐ First');
      expect(state.document.lineAt(1).text).to.equal('✔ Target @low @id(target)');
      state.setText('☐ First\n☐ Replacement @low');
      await state.commands.viewToggleDone(tasks[0]);
      expect(state.document.lineAt(1).text).to.equal('☐ Replacement @low');
      expect(state.messages[state.messages.length - 1]).to.include('file changed');
    }
  });
});
