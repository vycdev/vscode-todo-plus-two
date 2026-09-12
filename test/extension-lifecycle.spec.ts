import { expect } from 'chai';

const makeEvent = () => {
  const listeners = new Set<(event: any) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (event = {}) => listeners.forEach((listener) => listener(event)),
    listeners,
  };
};

const loadExtension = () => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/extension');
  const previous = require.cache[modulePath];
  const configuration = makeEvent();
  const folders = makeEvent();
  const documents = makeEvent();
  const editors = makeEvent();
  const dates = makeEvent();
  const visibleEditors = [{ supported: true }, { supported: false }];
  const events: string[] = [];
  const disposed: string[] = [];
  const disposable = (name: string) => ({ dispose: () => disposed.push(name) });
  const initialize = (name: string) => (context) => context.subscriptions.push(disposable(name));
  const files = {
    filesData: { '/workspace/tasks.todo': { saved: true } },
    generation: 0,
    unwatchPaths() {
      expect(this).to.equal(files);
      this.generation += 1;
    },
    dispose: () => disposed.push('files'),
  };
  const provider = {
    filesData: { '/workspace/source.ts': [{ message: 'saved' }] },
    generation: 0,
    unwatchPaths() {
      expect(this).to.equal(provider);
      this.generation += 1;
    },
    updateDocumentData: () => {
      events.push('embedded-document');
      return '/workspace/source.ts';
    },
    dispose: () => disposed.push('provider'),
  };
  const embedded = {
    provider,
    resets: 0,
    resetProvider() {
      this.resets += 1;
      this.provider.dispose();
      this.provider = undefined;
    },
    dispose() {
      disposed.push('embedded');
      if (this.provider) this.provider.dispose();
      this.provider = undefined;
    },
  };
  const utils = {
    editor: { isSupported: (editor) => editor.supported },
    files,
    embedded,
    folder: { initRootsRe() {} },
    init: { language: initialize('language'), views: initialize('views') },
    statistics: { tokens: { updateDisabledAll: () => events.push('tokens') } },
    command: disposable('command'),
    log: disposable('log'),
  };
  class Provider {
    static triggerCharacters = [];
  }
  class Diagnostics {
    initialize = initialize('diagnostics');
  }
  const vscode = {
    commands: { executeCommand: () => Promise.resolve() },
    workspace: {
      onDidChangeConfiguration: configuration.subscribe,
      onDidChangeWorkspaceFolders: folders.subscribe,
      onDidChangeTextDocument: documents.subscribe,
    },
    window: { onDidChangeActiveTextEditor: editors.subscribe, visibleTextEditors: visibleEditors },
    languages: {
      registerCompletionItemProvider: () => disposable('completion'),
      registerDocumentLinkProvider: () => disposable('links'),
      registerFoldingRangeProvider: () => disposable('folding'),
      registerDocumentSymbolProvider: () => disposable('symbols'),
    },
  };
  const mocks = {
    vscode,
    './commands': { registerCommands: initialize('commands') },
    './config': {
      default: {
        get: () => ({ embedded: { view: {} }, file: { view: {} } }),
        getKey: () => 'InSameFile',
        check() {},
      },
    },
    './consts': { default: { languageId: 'todo', update() {} } },
    './providers/file_links': { FileLinkProvider: Provider },
    './providers/embedded_diagnostics': { default: Diagnostics },
    './todo/decorators/document': { default: { update: () => events.push('decorations') } },
    './todo/decorators/changes': { default: { onChanges() {} } },
    './utils': { default: utils },
    './utils/dependency_index': { default: { initialize: initialize('index') } },
    './views/embedded': { default: { refreshFile: () => events.push('embedded-view') } },
    './views/files': { default: {} },
    './views/due': {
      Due: { refresh: () => events.push('due-view'), onDidChangeDate: dates.subscribe },
    },
    './statusbars/statistics': { default: disposable('statistics') },
    './statusbars/timer': { default: disposable('timer') },
  };
  NodeModule._load = (request, parent, isMain) => {
    if (parent && parent.filename === modulePath) {
      if (mocks[request]) return mocks[request];
      if (request.startsWith('./providers/')) return { default: Provider };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[modulePath];
    const { activate } = require(modulePath);
    return {
      activate,
      configuration,
      folders,
      documents,
      editors,
      dates,
      files,
      embedded,
      provider,
      events,
      disposed,
    };
  } finally {
    NodeModule._load = originalLoad;
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  }
};

describe('Extension lifecycle wiring', () => {
  it('invalidates file generations with bound callbacks and refreshes tokens before decorations', () => {
    const state = loadExtension();
    const context = { subscriptions: [] as { dispose(): void }[] };
    state.activate(context);
    const filesData = state.files.filesData;
    const embeddedData = state.provider.filesData;
    state.events.length = 0;

    try {
      state.configuration.fire({ affectsConfiguration: () => false });
      expect(state.files.generation).to.equal(1);
      expect(state.provider.generation).to.equal(1);
      expect(state.files.filesData).to.equal(filesData);
      expect(state.provider.filesData).to.equal(embeddedData);
      expect(state.events).to.deep.equal(['tokens', 'decorations']);

      state.events.length = 0;
      state.dates.fire();
      expect(state.events).to.deep.equal(['decorations']);

      state.folders.fire();
      expect(state.files.generation).to.equal(2);
      expect(state.provider.generation).to.equal(2);

      state.configuration.fire({ affectsConfiguration: (key) => key === 'todo.embedded.provider' });
      expect(state.files.generation).to.equal(3);
      expect(state.embedded.resets).to.equal(1);
      expect(state.embedded.provider).to.equal(undefined);
    } finally {
      context.subscriptions.forEach((subscription) => subscription.dispose());
    }
  });

  it('cancels pending document refreshes and disposes owned services and listeners', () => {
    const state = loadExtension();
    const context = { subscriptions: [] as { dispose(): void }[] };
    const timers = new Map<object, () => void>();
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let cleaned = false;
    global.setTimeout = ((callback, delay) => {
      expect(delay).to.equal(250);
      const handle = {};
      timers.set(handle, callback);
      return handle;
    }) as any;
    global.clearTimeout = ((handle) => timers.delete(handle)) as any;

    try {
      state.activate(context);
      state.events.length = 0;
      state.documents.fire({
        document: { uri: { scheme: 'file', fsPath: '/workspace/tasks.todo' }, languageId: 'todo' },
      });
      expect(timers.size).to.equal(2);

      context.subscriptions.forEach((subscription) => subscription.dispose());
      cleaned = true;
      expect(timers.size).to.equal(0);
      expect(state.disposed).to.include.members([
        'files',
        'embedded',
        'provider',
        'statistics',
        'timer',
        'command',
        'log',
        'diagnostics',
      ]);
      [state.configuration, state.folders, state.documents, state.editors, state.dates].forEach(
        (event) => expect(event.listeners.size).to.equal(0)
      );
      timers.forEach((callback) => callback());
      expect(state.events).to.deep.equal([]);
      expect(state.embedded.provider).to.equal(undefined);
    } finally {
      if (!cleaned) context.subscriptions.forEach((subscription) => subscription.dispose());
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});
