import { expect } from 'chai';

const makeEvent = () => {
  const listeners = new Set<(event: any) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (event) => listeners.forEach((listener) => listener(event)),
    listeners,
  };
};

const makeEditor = (
  lines = ['☐ hidden', 'Project:', '  ☐ visible @critical', '  ☐ other @low']
) => {
  const document = {
    version: 1,
    languageId: 'todo',
    isClosed: false,
    uri: {},
    get lineCount() {
      return lines.length;
    },
    lineAt: (line: number) => ({ text: lines[line] }),
  };
  const editor = {
    document,
    options: { tabSize: 4 },
    selections: [{ active: { line: 0 } }],
    allowEdit: true,
    insertions: 0,
    onEdit: () => {},
    edit: async (callback) => {
      if (!editor.allowEdit) return false;
      callback({
        insert: (_position, text: string) => lines.unshift(...text.trimEnd().split('\n')),
      });
      editor.insertions++;
      document.version++;
      editor.onEdit();
      return true;
    },
  };
  return { editor, lines };
};

const loadFocus = (initial = makeEditor()) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const paths = [
    '../src/tag_focus',
    '../src/providers/folding',
    '../src/utils/editor-configuration',
  ].map((file) => require.resolve(file));
  const previous = paths.map((file) => require.cache[file]);
  const documents = makeEvent();
  const editors = makeEvent();
  const closed = makeEvent();
  const configuration = makeEvent();
  const options = makeEvent();
  const calls: { command: string; args: any; value: any }[] = [];
  const messages: string[] = [];
  const registrations: { provider: any; disposed: boolean }[] = [];
  const config = { folding: true, foldingStrategy: 'auto', tabSize: 4 };
  const languageConfig: { [key: string]: any } = {};
  const hooks = {
    pick: async (_choices: string[]): Promise<string | undefined> => '@critical',
    execute: async (_command: string): Promise<void> => {},
  };
  const vscode = {
    version: '1.143.1',
    Position: class {
      constructor(
        public line,
        public character
      ) {}
    },
    Selection: class {
      active;
      constructor(line, _character, _endLine, _endCharacter) {
        this.active = { line };
      }
    },
    FoldingRange: class {
      constructor(
        public start,
        public end,
        public kind?
      ) {}
    },
    FoldingRangeKind: { Region: 'region' },
    commands: {
      executeCommand: async (command, args, value) => {
        calls.push({ command, args, value });
        await hooks.execute(command);
      },
    },
    window: {
      activeTextEditor: initial.editor,
      get visibleTextEditors() {
        return [this.activeTextEditor];
      },
      showInformationMessage: (message) => messages.push(message),
      showQuickPick: (choices) => hooks.pick(choices),
      onDidChangeActiveTextEditor: editors.subscribe,
      onDidChangeTextEditorOptions: options.subscribe,
    },
    workspace: {
      getConfiguration: (_section, scope) => ({
        get: (key) =>
          scope.languageId && key in languageConfig ? languageConfig[key] : config[key],
      }),
      onDidChangeTextDocument: documents.subscribe,
      onDidCloseTextDocument: closed.subscribe,
      onDidChangeConfiguration: configuration.subscribe,
    },
    languages: {
      registerFoldingRangeProvider: (_language, provider) => {
        const registration = { provider, disposed: false };
        registrations.push(registration);
        return {
          dispose: () => {
            registration.disposed = true;
          },
        };
      },
    },
  };
  initial.editor.onEdit = () => documents.fire({ document: initial.editor.document });
  NodeModule._load = (request, parent, isMain) => {
    if (parent && paths.includes(parent.filename)) {
      if (request === 'vscode') return vscode;
      if (request.endsWith('/consts'))
        return {
          default: {
            languageId: 'todo',
            regexes: {
              project: /^\s*[^☐✔✘]+:\s*$/gm,
              todo: /^\s*[☐✔✘] /gm,
              tag: /(?:^|[^a-zA-Z0-9`])(@[^\s*~(]+(?:\([^)]*\))?)/gm,
            },
          },
        };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    paths.forEach((file) => delete require.cache[file]);
    const focus = new (require(paths[0]).TagFocus)();
    focus.initialize({ subscriptions: [] });
    return {
      ...initial,
      focus,
      vscode,
      hooks,
      config,
      languageConfig,
      calls,
      messages,
      documents,
      editors,
      closed,
      configuration,
      options,
      registrations,
      getRanges: () =>
        registrations[registrations.length - 1].provider.provideFoldingRanges(
          initial.editor.document
        ),
    };
  } finally {
    NodeModule._load = originalLoad;
    paths.forEach((file, index) => {
      if (previous[index]) require.cache[file] = previous[index];
      else delete require.cache[file];
    });
  }
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('Tag focus commands', () => {
  it('inserts one persistent header and folds hidden runs while keeping ancestor context', async () => {
    const state = loadFocus();
    try {
      await state.focus.focus();
      expect(state.lines[0]).to.equal('(folded)');
      expect(state.editor.insertions).to.equal(1);
      expect(
        state.calls.filter(({ command }) => command === 'editor.fold').pop().args.selectionLines
      ).to.deep.equal([0, 3]);
      await state.focus.clear();
      expect(state.lines[0]).to.equal('(folded)');
      await state.focus.focus('@LOW');
      expect(state.editor.insertions).to.equal(1);
      expect(
        state.calls.filter(({ command }) => command === 'editor.fold').pop().args.selectionLines
      ).to.deep.equal([0, 2]);
    } finally {
      state.focus.dispose();
    }
  });

  it('reuses an existing opening region and restores region folding when cleared', async () => {
    const state = loadFocus(
      makeEditor(['@region', '☐ hidden', '☐ visible @critical', '@endregion'])
    );
    try {
      await state.focus.focus();
      expect(state.editor.insertions).to.equal(0);
      expect(state.getRanges().map(({ start, end }) => ({ start, end }))).to.deep.equal([
        { start: 0, end: 1 },
        { start: 2, end: 3 },
      ]);
      await state.focus.clear();
      expect(state.getRanges()).to.deep.equal([{ start: 0, end: 3, kind: 'region' }]);
    } finally {
      state.focus.dispose();
    }
  });

  it('does not insert a header on cancellation, absent tags, unsupported files, or disabled folding', async () => {
    const state = loadFocus();
    try {
      state.hooks.pick = async () => undefined;
      await state.focus.focus();
      state.lines.splice(0, state.lines.length, '☐ plain');
      await state.focus.focus();
      state.editor.document.languageId = 'typescript';
      await state.focus.focus();
      state.editor.document.languageId = 'todo';
      state.config.foldingStrategy = 'indentation';
      await state.focus.focus();
      expect(state.editor.insertions).to.equal(0);
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
    } finally {
      state.focus.dispose();
    }
  });

  it('aborts if the document changes or another editor is selected while the picker is open', async () => {
    const state = loadFocus();
    try {
      state.hooks.pick = async () => {
        state.editor.document.version++;
        return '@critical';
      };
      await state.focus.focus();
      state.hooks.pick = async () => {
        state.vscode.window.activeTextEditor = makeEditor().editor;
        return '@critical';
      };
      await state.focus.focus();
      expect(state.editor.insertions).to.equal(0);
      expect(state.messages).to.have.length(2);
    } finally {
      state.focus.dispose();
    }
  });

  it('does not insert a Todo header if the language changes while the picker is open', async () => {
    const state = loadFocus();
    try {
      state.hooks.pick = async () => {
        state.editor.document.languageId = 'plaintext';
        return '@critical';
      };
      await state.focus.focus();
      expect(state.editor.insertions).to.equal(0);
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
    } finally {
      state.focus.dispose();
    }
  });

  it('clears focus context when a language change closes the document without switching editors', async () => {
    const state = loadFocus();
    try {
      await state.focus.focus('@critical');
      state.editor.document.languageId = 'plaintext';
      state.closed.fire(state.editor.document);
      expect(state.calls.filter(({ command }) => command === 'setContext').pop().value).to.equal(
        false
      );
    } finally {
      state.focus.dispose();
    }
  });

  it('does not activate focus if the header edit is rejected', async () => {
    const state = loadFocus();
    try {
      state.editor.allowEdit = false;
      await state.focus.focus();
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
      expect(state.getRanges().some(({ start }) => start === 1)).to.equal(true);
    } finally {
      state.focus.dispose();
    }
  });

  it('never folds a different editor after an asynchronous unfold', async () => {
    const state = loadFocus();
    try {
      state.hooks.execute = async (command) => {
        if (command === 'editor.unfoldAll')
          state.vscode.window.activeTextEditor = makeEditor().editor;
      };
      await state.focus.focus();
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
    } finally {
      state.focus.dispose();
    }
  });

  it('cancels a pending fold when Clear Focus runs', async () => {
    const state = loadFocus();
    try {
      let pending: Promise<void>;
      state.hooks.execute = async (command) => {
        if (command === 'editor.unfoldAll' && !pending) pending = state.focus.clear();
      };
      await state.focus.focus();
      await pending;
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
    } finally {
      state.focus.dispose();
    }
  });

  it('refreshes focus after edits and disables it when the header is undone', async () => {
    const state = loadFocus();
    try {
      await state.focus.focus();
      state.lines[1] = '☐ newly matching @critical';
      state.editor.document.version++;
      state.documents.fire({ document: state.editor.document });
      await tick();
      expect(state.getRanges().some(({ start }) => start === 0)).to.equal(false);
      state.lines.shift();
      state.editor.document.version++;
      state.documents.fire({ document: state.editor.document });
      await tick();
      expect(state.calls.filter(({ command }) => command === 'setContext').pop().value).to.equal(
        false
      );
      expect(state.getRanges()).to.deep.equal([{ start: 1, end: 3, kind: undefined }]);
    } finally {
      state.focus.dispose();
    }
  });

  it('does not issue a fold command when all task lines match', async () => {
    const state = loadFocus(makeEditor(['(folded)', '☐ matching @critical']));
    try {
      await state.focus.focus();
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
    } finally {
      state.focus.dispose();
    }
  });

  it('ignores fenced tags and region examples while preserving real project context and code folds', async () => {
    const state = loadFocus(
      makeEditor([
        '@region',
        'Project:',
        '  ```todo',
        '@region',
        '☐ example @fake',
        '@endregion',
        '  ```',
        '  ☐ real @critical',
        '@endregion',
      ])
    );
    try {
      state.hooks.pick = async (choices) => {
        expect(choices).to.deep.equal(['@critical']);
        return '@critical';
      };
      await state.focus.focus();
      expect(state.getRanges()).to.deep.equal([
        { start: 1, end: 6, kind: undefined },
        { start: 7, end: 8, kind: undefined },
      ]);
      await state.focus.clear();
      expect(state.getRanges()).to.deep.equal([
        { start: 0, end: 8, kind: 'region' },
        { start: 1, end: 7, kind: undefined },
        { start: 2, end: 5, kind: undefined },
      ]);
    } finally {
      state.focus.dispose();
    }
  });

  it('does not insert a header when tags appear only in closed or unfinished code notes', async () => {
    for (const lines of [
      ['```todo', '☐ example @critical', '```'],
      ['```todo', '☐ example @critical'],
    ]) {
      const state = loadFocus(makeEditor(lines));
      try {
        await state.focus.focus('@critical');
        expect(state.editor.insertions).to.equal(0);
        expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
      } finally {
        state.focus.dispose();
      }
    }
  });

  it('honors Todo-specific folding settings before inserting the header', async () => {
    const state = loadFocus();
    try {
      state.languageConfig.foldingStrategy = 'indentation';
      await state.focus.focus();
      state.languageConfig.foldingStrategy = 'auto';
      state.languageConfig.folding = false;
      await state.focus.focus();
      expect(state.editor.insertions).to.equal(0);
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(false);
    } finally {
      state.focus.dispose();
    }
  });

  it('rechecks folding settings if they change while the tag picker is open', async () => {
    const state = loadFocus();
    try {
      state.hooks.pick = async () => {
        state.languageConfig.folding = false;
        state.configuration.fire({ affectsConfiguration: (key) => key === '[todo]' });
        return '@critical';
      };
      await state.focus.focus();
      expect(state.editor.insertions).to.equal(0);
    } finally {
      state.focus.dispose();
    }
  });

  it('continues refreshing an existing focus when a replacement tag picker is cancelled', async () => {
    const state = loadFocus(makeEditor(['(folded)', '☐ matching @critical']));
    try {
      await state.focus.focus('@critical');
      state.lines.push('☐ newly added unrelated task');
      state.editor.document.version++;
      state.documents.fire({ document: state.editor.document });
      state.hooks.pick = async () => undefined;
      await state.focus.focus();
      await tick();
      expect(state.calls.some(({ command }) => command === 'editor.fold')).to.equal(true);
    } finally {
      state.focus.dispose();
    }
  });

  it('clears focus when a language-specific override disables folding', async () => {
    const state = loadFocus();
    try {
      await state.focus.focus();
      state.languageConfig.folding = false;
      state.configuration.fire({ affectsConfiguration: (key) => key === '[todo]' });
      await tick();
      expect(state.calls.filter(({ command }) => command === 'setContext').pop().value).to.equal(
        false
      );
      expect(state.getRanges()).to.deep.equal([{ start: 2, end: 4, kind: undefined }]);
    } finally {
      state.focus.dispose();
    }
  });

  it('refreshes parent context when the editor tab width changes', async () => {
    const state = loadFocus(
      makeEditor(['(folded)', 'Root:', '\tParent:', '    ☐ matching @critical', '  ☐ other'])
    );
    try {
      await state.focus.focus('@critical');
      expect(state.getRanges().some(({ start, end }) => start < 2 && 2 <= end)).to.equal(true);
      state.editor.options.tabSize = 2;
      state.options.fire({ textEditor: state.editor });
      await tick();
      expect(state.getRanges()).to.deep.equal([{ start: 3, end: 4, kind: undefined }]);
      expect(
        state.calls.filter(({ command }) => command === 'editor.fold').pop().args.selectionLines
      ).to.deep.equal([3]);
    } finally {
      state.focus.dispose();
    }
  });

  it('disposes registrations, event listeners, and scheduled refreshes', async () => {
    const state = loadFocus();
    await state.focus.focus();
    state.documents.fire({ document: state.editor.document });
    state.focus.dispose();
    const count = state.calls.length;
    await tick();
    expect(state.calls).to.have.length(count);
    expect(state.registrations.every(({ disposed }) => disposed)).to.equal(true);
    [state.documents, state.editors, state.closed, state.configuration, state.options].forEach(
      (event) => expect(event.listeners.size).to.equal(0)
    );
  });

  it('declares command activation and palette entries', () => {
    const pkg = require('../package.json');
    ['todo.focusTag', 'todo.clearFocus'].forEach((command) => {
      expect(pkg.activationEvents).to.include(`onCommand:${command}`);
      expect(pkg.contributes.commands.some((entry) => entry.command === command)).to.equal(true);
      expect(
        pkg.contributes.menus.commandPalette.some((entry) => entry.command === command)
      ).to.equal(true);
    });
  });
});
