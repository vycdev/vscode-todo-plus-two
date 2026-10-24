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
        CompletionItemKind: { Reference: 1, Value: 2 },
      };
    if (request === '../consts')
      return {
        default: { symbols: { tag: '@' }, regexes: { tagNormal: /^@note/ }, tags: { names: [] } },
      };
    if (request === '../config') return { default: { getKey: () => undefined } };
    if (request === '../todo/document')
      return {
        default: class Document {
          getTags() {
            return [{ text: '@note(one)' }];
          }
        },
      };
    if (request === '../utils/timestamps')
      return { default: { getPrefix: () => undefined, aliases: [] } };
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

describe('Tag argument completions', () => {
  it('replaces an auto-closed parenthesis without duplicating it', async () => {
    const { Completion } = loadCompletion();
    const text = 'Task @note()';
    const character = text.indexOf(')');
    const completions = await new Completion().provideCompletionItems(
      { lineAt: () => ({ text }) },
      { line: 0, character }
    );
    const completion = completions.find((item) => item.label === '@note(one)');

    expect(completion).not.to.equal(undefined);
    const result =
      text.slice(0, completion.range.startCharacter) +
      completion.insertText +
      text.slice(completion.range.endCharacter);
    expect(result).to.equal('Task @note(one) ');
  });
});
