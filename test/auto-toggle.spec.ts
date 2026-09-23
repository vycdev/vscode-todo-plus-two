import { expect } from 'chai';

const loadToggleStart = (applyPauses = true) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    modulePath = require.resolve('../src/commands'),
    previous = require.cache[modulePath],
    currentDocument = {
      uri: { toString: () => 'file:///current.todo' },
      version: 1,
      isClosed: false,
      lineAt: () => ({ text: 'Task', lineNumber: 0 }),
    },
    otherDocument = {
      uri: { toString: () => 'file:///other.todo' },
      version: 1,
      isClosed: false,
      lineAt: () => ({ text: 'Task', lineNumber: 0 }),
    },
    editor = {
      document: currentDocument,
      selections: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }],
    },
    paused: string[] = [],
    started: number[] = [],
    appliedPauses: any[] = [];

  class WorkspaceEdit {
    edits = new Map<string, any[]>();

    set(uri, edits) {
      this.edits.set(uri.toString(), edits);
    }
  }

  const vscode = {
    window: { activeTextEditor: editor, showErrorMessage() {}, showInformationMessage() {} },
    workspace: {
      applyEdit: async (edit) => {
        appliedPauses.push(edit);
        return applyPauses;
      },
    },
    WorkspaceEdit,
  };
  const selectedTodo = {
    text: 'Task',
    isBox: () => true,
    hasTag: () => false,
    toggleStart: () => started.push(0),
    makeEdit: () => [{ text: 'started' }],
  };
  const activeTodo = (file: string, lineNumber: number) => ({
    text: 'active @started(now)',
    line: { lineNumber },
    addTag: (tag) => paused.push(`${file}:${lineNumber}:${tag}`),
    makeEdit: () => [{ text: `paused ${file}:${lineNumber}` }],
  });

  class Document {
    document;

    constructor(resource) {
      this.document = resource.document || resource;
    }

    isSupported() {
      return true;
    }

    getTodoAt() {
      return selectedTodo;
    }

    getTodosBoxStarted() {
      return this.document === currentDocument
        ? [activeTodo('current', 0), activeTodo('current', 1)]
        : [activeTodo('other', 0)];
    }
  }

  const otherFile = { textEditor: otherDocument },
    currentFile = { textEditor: currentDocument },
    mocks = {
      './config': { default: { getKey: (key) => key === 'timekeeping.autoToggle' } },
      './consts': { default: { regexes: { tagStarted: /@started/ }, symbols: { tag: '@' } } },
      './todo/document': { default: Document },
      './utils': {
        default: {
          editor: { edits: { apply: async () => true } },
          file: { open: async () => editor },
        },
      },
      './utils/files': {
        default: {
          get: async () => ({
            root: { current: currentFile, other: otherFile },
            '': { current: currentFile, other: otherFile },
          }),
        },
      },
      './utils/timekeeping': {
        getTimerState: (text) => ({ active: text.startsWith('active') }),
        getToggleTag: () => '@toggle(now)',
      },
    };

  NodeModule._load = (request, parent, isMain) => {
    if (parent && parent.filename === modulePath) {
      if (request === 'vscode') return vscode;
      if (mocks[request]) return mocks[request];
      if (request.startsWith('.')) return {};
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[modulePath];
    const commands = require(modulePath);
    return {
      toggleStart: commands.toggleStart,
      viewToggleStart: commands.viewToggleStart,
      paused,
      started,
      appliedPauses,
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Automatic timer toggling', () => {
  it('pauses other timers in the current file and workspace only once', async () => {
    const state = loadToggleStart();

    await state.toggleStart();

    expect(state.paused).to.deep.equal(['current:1:@toggle(now)', 'other:0:@toggle(now)']);
    expect(state.started).to.deep.equal([0]);
    expect(state.appliedPauses).to.have.length(1);
    expect([...state.appliedPauses[0].edits.keys()]).to.deep.equal([
      'file:///current.todo',
      'file:///other.todo',
    ]);
  });

  it('does not start the selected task when pausing another timer fails', async () => {
    const state = loadToggleStart(false);

    await state.toggleStart();

    expect(state.appliedPauses).to.have.length(1);
    expect(state.started).to.deep.equal([]);
  });

  it('uses the same auto-toggle path when starting a task from the tree', async () => {
    const state = loadToggleStart();

    await state.viewToggleStart({ obj: { filePath: '/workspace/current.todo', lineNr: 0 } });

    expect(state.paused).to.deep.equal(['current:1:@toggle(now)', 'other:0:@toggle(now)']);
    expect(state.started).to.deep.equal([0]);
  });
});
