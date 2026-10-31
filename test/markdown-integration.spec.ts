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
  const messages: string[] = [];
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
      createTextEditorDecorationType: () => ({ dispose() {} }),
    },
    workspace: {
      textDocuments: [document],
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
  const files = { getFilePaths: async () => [], get: async () => ({}), filesData: {} };
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
            transfers.push({ destination, content: merge('# Archive\n\nSaved note.\n') });
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
      Document,
      decorator,
      utils,
      filesView,
      dueView,
      fileService,
      completion,
      transfers,
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
