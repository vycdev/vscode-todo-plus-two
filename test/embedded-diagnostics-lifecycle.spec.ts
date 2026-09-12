import { expect } from 'chai';

const loadEmbeddedDiagnostics = (mapping) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    diagnosticsPath = require.resolve('../src/providers/embedded_diagnostics'),
    previousDiagnostics = require.cache[diagnosticsPath];

  NodeModule._load = (request: string, parent, isMain: boolean) => {
    if (request === 'vscode') {
      return {
        DiagnosticSeverity: {
          Error: 0,
          Warning: 1,
          Information: 2,
          Hint: 3,
        },
      };
    }
    if (request === '../config') {
      return { default: { getKey: () => mapping } };
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[diagnosticsPath];
    return require('../src/providers/embedded_diagnostics').default;
  } finally {
    NodeModule._load = originalLoad;
    if (previousDiagnostics) {
      require.cache[diagnosticsPath] = previousDiagnostics;
    } else {
      delete require.cache[diagnosticsPath];
    }
  }
};

describe('Embedded diagnostics lifecycle', () => {
  it('does not publish or subscribe after disposal while provider initialization is pending', async () => {
    const EmbeddedDiagnostics = loadEmbeddedDiagnostics({ TODO: 'warning' });
    let release: () => void;
    let subscriptions = 0;
    let clears = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = {
      get: async () => undefined,
      onDidChangeData: () => {
        subscriptions += 1;
      },
    };
    const diagnostics = new EmbeddedDiagnostics({
      provider,
      initProvider: () => gate,
    });
    diagnostics.collection = {
      clear: () => {
        clears += 1;
      },
    };
    const pending = diagnostics.refreshAll();
    diagnostics.dispose();
    release!();
    await pending;
    expect(subscriptions).to.equal(0);
    expect(clears).to.equal(0);
  });

  it('clears stale diagnostics and detaches when the provider disappears', async () => {
    const mapping = { TODO: 'warning' },
      EmbeddedDiagnostics = loadEmbeddedDiagnostics(mapping);
    let clearCount = 0,
      disposeCount = 0;
    const collection = {
      clear: () => {
        clearCount += 1;
      },
      set: () => undefined,
    };
    const provider = {
      filesData: {},
      get: async () => undefined,
      getCachedFilePath: (filePath: string) => filePath,
      onDidChangeData: () => ({
        dispose: () => {
          disposeCount += 1;
        },
      }),
    };
    const embedded = {
      provider,
      initProvider: async () => undefined,
    };
    const diagnostics = new EmbeddedDiagnostics(embedded);

    diagnostics.collection = collection;
    await diagnostics.refreshAll();

    expect(clearCount).to.equal(1);
    expect(disposeCount).to.equal(0);

    embedded.provider = undefined;
    await diagnostics.refreshAll();

    expect(clearCount).to.equal(2);
    expect(disposeCount).to.equal(1);
    expect(diagnostics.provider).to.equal(undefined);
    expect(diagnostics.providerDisposable).to.equal(undefined);

    embedded.provider = provider;
    await diagnostics.refreshAll();
    delete mapping.TODO;
    embedded.provider = undefined;
    await diagnostics.refreshAll();

    expect(clearCount).to.equal(4);
    expect(disposeCount).to.equal(2);
    expect(diagnostics.provider).to.equal(undefined);
    expect(diagnostics.providerDisposable).to.equal(undefined);
  });
});
