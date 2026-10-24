import { expect } from 'chai';

const makeEditor = () => ({
  document: {
    version: 1,
    isClosed: false,
    uri: { fsPath: '/workspace/TODO' },
    lineAt: () => ({ text: '☐ Task', lineNumber: 0 }),
  },
  selections: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }],
  selection: { active: { line: 0, character: 0 } },
});

const loadCommands = (activeEditor = makeEditor(), todoText = '☐ Task') => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/commands');
  const previous = require.cache[modulePath];
  const mutatedEditors: any[] = [];
  const mutatedLines: number[] = [];
  const edits: any[] = [];
  const messages: string[] = [];
  const registrations: string[] = [];
  const vscode = {
    window: {
      activeTextEditor: activeEditor,
      showErrorMessage: (message) => messages.push(message),
      showInformationMessage: (message) => messages.push(message),
      showQuickPick: async () => ({ label: 'dependency' }),
    },
    extensions: { getExtension: () => ({ packageJSON: require('../package.json') }) },
    commands: {
      registerCommand: (id, handler) => {
        expect(handler).to.be.a('function');
        registrations.push(id);
        return { dispose() {} };
      },
    },
  };
  const utils = {
    log: { debug() {} },
    file: { open: async () => activeEditor },
    archive: { run: async () => undefined },
    editor: {
      edits: {
        apply: async (...args) => {
          edits.push(args);
          return true;
        },
      },
    },
  };
  const dependencyIndex = {
    get: async (_document?) => ({ targets: {}, dependencies: {} }),
    isFinished: () => true,
  };
  class Document {
    constructor(public editor) {}
    isSupported() {
      return !!this.editor;
    }
    getTodoAt(lineNumber) {
      const mutate = () => {
        mutatedEditors.push(this.editor);
        mutatedLines.push(lineNumber);
      };
      return {
        text: todoText,
        isDone: () => false,
        isCancelled: () => false,
        isFinished: () => false,
        toggleBox: mutate,
        toggleDone: mutate,
        toggleCancelled: mutate,
        addTag: mutate,
        makeEdit: () => [{ text: '✔ Task' }],
      };
    }
  }
  const mocks = {
    './config': { default: { getKey: () => false } },
    './consts': { default: { symbols: { tag: '@' } } },
    './todo/document': { default: Document },
    './utils': { default: utils },
    './utils/dependency_index': { default: dependencyIndex },
  };
  NodeModule._load = (request, parent, isMain) => {
    if (parent && parent.filename === modulePath) {
      if (request === 'vscode') return vscode;
      if (mocks[request]) return mocks[request];
      if (request.startsWith('.') && request !== './utils/dependencies') return {};
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[modulePath];
    const commands = require(modulePath);
    return {
      commands,
      vscode,
      utils,
      dependencyIndex,
      mutatedEditors,
      mutatedLines,
      edits,
      messages,
      registrations,
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Command edit safety', () => {
  it('does not apply stale task edits after asynchronous dependency checks', async () => {
    const editor = makeEditor();
    const state = loadCommands(editor, '☐ Task @depends(setup)');
    state.dependencyIndex.get = async () => {
      editor.document.version++;
      return {
        targets: { setup: [{ filePath: '/workspace/TODO', lineNumber: 4, text: '✔ Setup' }] },
        dependencies: {},
      };
    };
    await state.commands.toggleDone();
    expect(state.mutatedEditors).to.deep.equal([]);
    expect(state.edits).to.deep.equal([]);
    expect(state.messages[0]).to.include('file changed');
  });

  it('toggles tasks without dependencies without scanning the workspace', async () => {
    const state = loadCommands();
    state.dependencyIndex.get = async () => {
      throw new Error('The dependency index should not be built');
    };
    await state.commands.toggleDone();
    await state.commands.toggleCancelled();
    expect(state.mutatedLines).to.deep.equal([0, 0]);
    expect(state.edits.length).to.equal(2);
    expect(state.messages).to.deep.equal([]);
  });

  it('blocks finishing a task whose dependency is unfinished', async () => {
    const state = loadCommands(makeEditor(), '☐ Task @depends(setup)');
    state.dependencyIndex.get = async () => ({
      targets: { setup: [{ filePath: '/workspace/TODO', lineNumber: 4, text: '☐ Setup' }] },
      dependencies: {},
    });
    state.dependencyIndex.isFinished = () => false;
    await state.commands.toggleDone();
    expect(state.edits).to.deep.equal([]);
    expect(state.messages[0]).to.include('unresolved dependencies (setup)');
  });

  it('does not edit a task changed while its dependency picker was open', async () => {
    const editor = makeEditor();
    const state = loadCommands(editor);
    state.dependencyIndex.get = async () => ({ targets: { dependency: [{}] }, dependencies: {} });
    state.vscode.window.showQuickPick = async () => {
      editor.document.version++;
      return { label: 'dependency' };
    };
    await state.commands.addDependency();
    expect(state.edits).to.deep.equal([]);
    expect(state.mutatedEditors).to.deep.equal([]);
  });

  it('uses the editor opened by a tree action when focus changes', async () => {
    const target = makeEditor();
    const unrelated = makeEditor();
    const state = loadCommands(unrelated);
    state.utils.file.open = async () => target;
    await state.commands.viewToggleBox({ obj: { filePath: '/workspace/TODO', lineNr: 0 } });
    expect(state.mutatedEditors).to.deep.equal([target]);
    expect(state.edits[0][0]).to.equal(target);
  });

  it('does not toggle an unselected task at the start of the ending line', async () => {
    const editor = makeEditor();
    editor.selections[0].end.line = 1;
    const state = loadCommands(editor);
    await state.commands.toggleBox();
    expect(state.mutatedLines).to.deep.equal([0]);
  });

  it('reports archive failures and waits for the archive operation', async () => {
    const state = loadCommands();
    state.utils.archive.run = async () => {
      throw new Error('Destination unavailable');
    };
    await state.commands.archive();
    expect(state.messages).to.deep.equal(['Unable to archive tasks: Destination unavailable']);
  });

  it('registers every contributed command with a callable handler and owned disposable', () => {
    const state = loadCommands();
    const context = { subscriptions: [] };
    state.commands.registerCommands(context, state.commands);
    expect(state.registrations).to.deep.equal(
      require('../package.json').contributes.commands.map(({ command }) => command)
    );
    expect(context.subscriptions.length).to.equal(state.registrations.length);
  });
});
