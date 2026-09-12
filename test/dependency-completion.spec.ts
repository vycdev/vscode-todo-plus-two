import { expect } from 'chai';

const loadCompletion = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load;
  const subjectPath = require.resolve('../src/providers/completion');
  const previous = require.cache[subjectPath];
  let lookups = 0;
  NodeModule._load = (request, parent, isMain) => {
    if (request === 'vscode')
      return {
        Range: class Range {
          constructor(
            public startLine,
            public startCharacter,
            public endLine,
            public endCharacter
          ) {}
        },
        CompletionItem: class CompletionItem {
          constructor(
            public label,
            public kind
          ) {}
        },
        CompletionItemKind: { Reference: 1 },
      };
    if (request === '../consts') return { default: { symbols: { tag: '@' } } };
    if (request === '../config' || request === '../todo/document') return { default: {} };
    if (request === '../utils/timestamps') return { default: { getPrefix: () => undefined } };
    if (request === '../utils/dependency_index')
      return {
        default: {
          get: async () => {
            lookups++;
            return { targets: { release: [{}] } };
          },
        },
      };
    return originalLoad(request, parent, isMain);
  };
  try {
    delete require.cache[subjectPath];
    return { Completion: require(subjectPath).default, getLookups: () => lookups };
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (previous) require.cache[subjectPath] = previous;
  }
};

describe('Dependency completions', () => {
  it('replaces an existing closing parenthesis when completing an ID', async () => {
    const { Completion } = loadCompletion();
    const text = 'task @DEPENDS(rel)';
    const character = text.indexOf(')');
    const [completion] = await new Completion().provideCompletionItems(
      { lineAt: () => ({ text }) },
      { line: 0, character }
    );
    const result =
      text.slice(0, completion.range.startCharacter) +
      completion.insertText +
      text.slice(completion.range.endCharacter);

    expect(result).to.equal('task @DEPENDS(release)');
  });

  it('does not resolve embedded references or references inside inline code', async () => {
    const { Completion, getLookups } = loadCompletion();
    for (const text of ['task word@depends(rel', 'task `@depends(rel', 'task ``@depends(rel']) {
      expect(
        await new Completion().provideCompletionItems(
          { lineAt: () => ({ text }) },
          { line: 0, character: text.length }
        )
      ).to.equal(null);
    }
    expect(getLookups()).to.equal(0);
  });
});
