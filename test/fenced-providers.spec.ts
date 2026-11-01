import { expect } from 'chai';

const withProvider = async (name: string, run: (Provider: any) => Promise<void> | void) => {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const subject = require.resolve(`../src/providers/${name}`);
  const previous = require.cache[subject];
  const configurationPath = require.resolve('../src/utils/editor-configuration');
  const previousConfiguration = require.cache[configurationPath];
  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position
    ) {}
  }
  class DocumentLink {
    constructor(
      public range: Range,
      public target: string
    ) {}
  }
  class FoldingRange {
    constructor(
      public start: number,
      public end: number
    ) {}
  }
  NodeModule._load = (request, parent, isMain) => {
    if (parent && (parent.filename === subject || parent.filename === configurationPath)) {
      if (request === 'vscode')
        return {
          Position,
          Range,
          DocumentLink,
          FoldingRange,
          FoldingRangeKind: { Region: 'region' },
          version: '1.36.0',
          window: { visibleTextEditors: [] },
          Uri: { parse: (value) => value },
          workspace: {
            getConfiguration: (section) => ({ get: () => (section === 'editor' ? 2 : undefined) }),
          },
        };
      if (request === '../consts')
        return {
          default: {
            symbols: { tag: '@' },
            regexes: { project: /^\s*[^:]+:\s*$/m, todo: /^\s*[☐✔✘] /gm },
          },
        };
      if (request === '../todo/document' || request === '../config') return { default: {} };
      if (request === '../utils/dependency_index')
        return { default: { get: async () => ({ targets: { real: [{}] } }) } };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subject];
    delete require.cache[configurationPath];
    const loaded = require(subject);
    await run(name === 'folding' ? loaded.FoldingProvider : loaded.default);
  } finally {
    NodeModule._load = originalLoad;
    if (previousConfiguration) require.cache[configurationPath] = previousConfiguration;
    else delete require.cache[configurationPath];
    if (previous) require.cache[subject] = previous;
    else delete require.cache[subject];
  }
};

const document = (text: string) => {
  const lines = text.split('\n');
  return {
    getText: () => text,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] }),
    uri: {},
  };
};

describe('Fenced language providers', () => {
  it('does not offer Todo tag or dependency completion in code', async () => {
    await withProvider('completion', async (Provider) => {
      const doc = document('```ts\n@depends(real\n```');
      expect(
        await new Provider().provideCompletionItems(doc, { line: 1, character: 13 })
      ).to.deep.equal([]);
    });
  });

  it('only creates dependency links outside fenced examples', async () => {
    await withProvider('dependency_links', async (Provider) => {
      const doc = document('```ts\n@depends(real)\n```\n☐ task @depends(real)');
      const links = await new Provider().provideDocumentLinks(doc);
      expect(links).to.have.length(1);
      expect(links[0].range.start.line).to.equal(3);
    });
  });

  it('folds a whole code note without treating its payload as project structure', async () => {
    await withProvider('folding', (Provider) => {
      const ranges = new Provider().provideFoldingRanges(
        document('Work:\n  ```sql\nArchive:\n  ```\nNext:')
      );
      expect(ranges.map(({ start, end }) => ({ start, end }))).to.deep.equal([
        { start: 0, end: 3 },
        { start: 1, end: 2 },
      ]);
    });
  });
});
