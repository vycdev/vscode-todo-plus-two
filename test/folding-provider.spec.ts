import { expect } from 'chai';

const loadFoldingProvider = (tabSize: number | string = 4, visibleTextEditors = []) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const modulePath = require.resolve('../src/providers/folding');
  const previous = require.cache[modulePath];
  const configurationPath = require.resolve('../src/utils/editor-configuration');
  const previousConfiguration = require.cache[configurationPath];

  class FoldingRange {
    constructor(
      public start: number,
      public end: number,
      public kind?: string
    ) {}
  }

  NodeModule._load = (request, parent, isMain) => {
    if (parent && (parent.filename === modulePath || parent.filename === configurationPath)) {
      if (request === 'vscode') {
        return {
          FoldingRange,
          version: '1.36.0',
          window: { visibleTextEditors },
          FoldingRangeKind: { Region: 'region' },
          workspace: {
            getConfiguration: (section) => ({
              get: () => (section === 'editor' ? tabSize : undefined),
            }),
          },
        };
      }
      if (request === '../consts') {
        return { default: { regexes: { project: /^\s*[^☐✔✘]+:\s*$/gm, todo: /^\s*[☐✔✘] /gm } } };
      }
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[modulePath];
    delete require.cache[configurationPath];
    return new (require(modulePath).FoldingProvider)();
  } finally {
    NodeModule._load = originalLoad;
    if (previousConfiguration) require.cache[configurationPath] = previousConfiguration;
    else delete require.cache[configurationPath];
    if (previous) {
      require.cache[modulePath] = previous;
    } else {
      delete require.cache[modulePath];
    }
  }
};

const makeDocument = (lines: string[]) => ({
  lineCount: lines.length,
  lineAt: (lineNumber: number) => ({ text: lines[lineNumber] }),
});

describe('Todo folding provider', () => {
  it('marks explicit regions for Fold All Regions while retaining ordinary project folds', () => {
    const provider = loadFoldingProvider();
    const document = makeDocument(['@region', 'Project:', '  ☐ task', '@endregion']);

    expect(provider.provideFoldingRanges(document)).to.deep.equal([
      { start: 0, end: 3, kind: 'region' },
      { start: 1, end: 2, kind: undefined },
    ]);
  });

  it('recomputes regions after edits, including a removed closing marker', () => {
    const provider = loadFoldingProvider();
    const lines = ['@region', '☐ task', '@endregion'];
    const document = makeDocument(lines);

    expect(provider.provideFoldingRanges(document)).to.have.length(1);
    lines[2] = '☐ another task';
    expect(provider.provideFoldingRanges(document)).to.deep.equal([]);
  });

  it('preserves configured indentation and the fallback for nonnumeric tab sizes', () => {
    const document = makeDocument(['Root:', '\tChild:', '\t  ☐ nested', '    ☐ sibling']);

    expect(loadFoldingProvider(4).provideFoldingRanges(document)).to.deep.equal([
      { start: 0, end: 3, kind: undefined },
      { start: 1, end: 2, kind: undefined },
    ]);
    expect(loadFoldingProvider(2).provideFoldingRanges(document)).to.deep.equal([
      { start: 0, end: 3, kind: undefined },
      { start: 1, end: 3, kind: undefined },
    ]);
    expect(loadFoldingProvider('auto').provideFoldingRanges(document)).to.deep.equal(
      loadFoldingProvider(4).provideFoldingRanges(document)
    );
  });

  it('uses the visible editor tab width when it differs from the configured default', () => {
    const document = makeDocument(['Root:', '\tChild:', '\t  ☐ nested', '    ☐ sibling']);
    const provider = loadFoldingProvider(4, [{ document, options: { tabSize: 2 } }]);

    expect(provider.provideFoldingRanges(document)).to.deep.equal([
      { start: 0, end: 3, kind: undefined },
      { start: 1, end: 3, kind: undefined },
    ]);
  });
});
