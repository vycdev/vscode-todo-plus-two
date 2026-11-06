import { expect } from 'chai';

const loadDependencyIndex = (vscodeStub, files) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    dependencyIndexPath = require.resolve('../src/utils/dependency_index'),
    previousDependencyIndex = require.cache[dependencyIndexPath];

  NodeModule._load = function (request: string, parent, isMain: boolean) {
    if (request === 'vscode') return vscodeStub;
    if (parent && parent.filename.replace(/\\/g, '/').endsWith('/dependency_index.ts')) {
      if (request === '../consts') {
        return { default: { languageId: 'todo', regexes: { todo: /^\s*☐/ } } };
      }
      if (request === './files') return { default: files };
      if (request === './folder') return { default: { getAllRootPaths: () => ['/workspace'] } };
      if (request === './regex') {
        return { default: { test: (regex: RegExp, text: string) => regex.test(text) } };
      }
      if (request === './refresh-delay') {
        return { debounceRefresh: (callback) => Object.assign(callback, { cancel() {} }) };
      }
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[dependencyIndexPath];
    return require('../src/utils/dependency_index').default;
  } finally {
    NodeModule._load = originalLoad;
    if (previousDependencyIndex) {
      require.cache[dependencyIndexPath] = previousDependencyIndex;
    } else {
      delete require.cache[dependencyIndexPath];
    }
  }
};

const makeDocument = (name: string, initial: string[]) => {
  let lines = initial;
  const document = {
    reads: 0,
    languageId: 'todo',
    version: 1,
    uri: {
      scheme: 'file',
      fsPath: `/workspace/${name}`,
      toString: () => `file:///workspace/${name}`,
    },
    get lineCount() {
      return lines.length;
    },
    lineAt: (line: number) => {
      document.reads++;
      return { text: lines[line] };
    },
    getText: () => {
      document.reads++;
      return lines.join('\n');
    },
    setLines(next: string[]) {
      lines = next;
      document.version++;
    },
  };
  return document;
};

describe('Dependency index caching', () => {
  it('indexes loaded workspace documents without reopening them', async () => {
    const a = makeDocument('a.todo', ['☐ Setup @id(setup)']),
      b = makeDocument('b.todo', ['☐ Ship @depends(setup)']);
    const vscodeStub = {
      workspace: {
        textDocuments: [],
        openTextDocument: () => {
          throw new Error('The index must reuse documents loaded by Files');
        },
      },
    };
    const DependencyIndex = loadDependencyIndex(vscodeStub, {
      getDocuments: async () => ({ '/workspace/a.todo': a, '/workspace/b.todo': b }),
    });

    const index = await DependencyIndex.get();

    expect(Object.keys(index.targets)).to.deep.equal(['setup']);
    expect(index.dependencies.setup.map((dependency) => dependency.filePath)).to.deep.equal([
      '/workspace/b.todo',
    ]);
  });

  it('rescans only documents whose version changed', async () => {
    const a = makeDocument('a.todo', ['☐ Setup @id(setup)']),
      b = makeDocument('b.todo', ['☐ Ship @depends(setup)']);
    const DependencyIndex = loadDependencyIndex(
      { workspace: { textDocuments: [] } },
      { getDocuments: async () => ({ '/workspace/a.todo': a, '/workspace/b.todo': b }) }
    );

    await DependencyIndex.get();
    a.reads = b.reads = 0;
    await DependencyIndex.get();
    expect([a.reads, b.reads]).to.deep.equal([0, 0]);

    a.setLines(['☐ Setup @id(renamed)']);
    const index = await DependencyIndex.get();

    expect(a.reads).to.be.greaterThan(0);
    expect(b.reads).to.equal(0);
    expect(Object.keys(index.targets)).to.deep.equal(['renamed']);
    expect(Object.keys(index.dependencies)).to.deep.equal(['setup']);
  });

  it('prefers an open buffer over the loaded copy of the same file', async () => {
    const loaded = makeDocument('a.todo', ['☐ Setup @id(saved)']),
      live = makeDocument('a.todo', ['☐ Setup @id(unsaved)']);
    const DependencyIndex = loadDependencyIndex(
      { workspace: { textDocuments: [live] } },
      { getDocuments: async () => ({ '/workspace/a.todo': loaded }) }
    );

    const index = await DependencyIndex.get();

    expect(Object.keys(index.targets)).to.deep.equal(['unsaved']);
    expect(loaded.reads).to.equal(0);
  });

  it('reloads a closed document only when it had unsaved edits', () => {
    let closeListener: (document: any) => void;
    const invalidated = [];
    const register = () => ({ dispose() {} });
    const vscodeStub = {
      languages: {
        createDiagnosticCollection: () => ({ dispose() {}, clear() {}, set() {} }),
      },
      workspace: {
        textDocuments: [],
        onDidChangeTextDocument: register,
        onDidOpenTextDocument: register,
        onDidCloseTextDocument: (listener) => {
          closeListener = listener;
          return register();
        },
        onDidChangeWorkspaceFolders: register,
        onDidChangeConfiguration: register,
      },
    };
    const DependencyIndex = loadDependencyIndex(vscodeStub, {
      getDocuments: async () => ({}),
      invalidateDocument: (document) => invalidated.push(document),
    });
    const subscriptions = [];
    DependencyIndex.updateDiagnostics = async () => undefined;
    DependencyIndex.initialize({ subscriptions });

    const clean = { languageId: 'todo', isDirty: false },
      dirty = { languageId: 'todo', isDirty: true };
    closeListener(clean);
    closeListener(dirty);

    expect(invalidated).to.deep.equal([dirty]);
    subscriptions.forEach((subscription) => subscription.dispose());
  });
});
