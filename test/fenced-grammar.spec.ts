import { expect } from 'chai';
import { readFileSync } from 'fs';
import { Registry, INITIAL, IGrammar, IRawGrammar } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import { parseCodeBlocks } from '../src/utils/code-blocks';

const rawGrammar = require('../syntax/grammar.tmLanguage.json');
const codeGrammar = require('../syntax/fenced-code.tmLanguage.json');
const catalog = require('../syntax/code-languages.json');
const pkg = require('../package.json');

describe('Fenced TextMate tokenization', () => {
  let grammar: IGrammar;
  let registry: Registry;

  before(async () => {
    await loadWASM(
      readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer as ArrayBuffer
    );
    registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new OnigScanner(patterns),
        createOnigString: (text) => new OnigString(text),
      }),
      loadGrammar: async (scopeName) => {
        if (scopeName === 'text.todo') return rawGrammar;
        if (scopeName === 'text.todo.fenced') return codeGrammar;
        // Small embedded grammars exercise external includes and multiline state
        // without copying VS Code's bundled language grammars into the extension.
        if (
          [
            'source.js',
            'source.ts',
            'source.sql',
            'source.python',
            'source.cpp',
            'source.cs',
            'source.shell',
            'source.yaml',
            'source.rust',
            'source.go',
            'source.js.jsx',
            'source.tsx',
            'text.html.derivative',
            'source.hcl',
          ].indexOf(scopeName) >= 0
        ) {
          return {
            scopeName,
            patterns: [
              { begin: '/\\*', end: '\\*/', name: 'comment.block.fixture' },
              { match: '\\b(const|SELECT)\\b', name: `keyword.fixture.${scopeName}` },
            ],
          } as IRawGrammar;
        }
        return null;
      },
    });
    const mapping = pkg.contributes.grammars.find(
      ({ language }) => language === 'todo'
    ).embeddedLanguages;
    const ids = {};
    Object.keys(mapping).forEach((scope) => (ids[scope] = mapping[scope] === 'plaintext' ? 2 : 3));
    grammar = await registry.loadGrammarWithEmbeddedLanguages('text.todo', 1, ids);
  });

  after(() => registry.dispose());

  it('ships reproducible grammar and manifest mappings for the pinned Linguist catalog', () => {
    const { createCodeGrammar } = require('../scripts/generate-code-grammar');
    const generated = createCodeGrammar(catalog);
    expect(codeGrammar).to.deep.equal(generated.grammar);
    expect(
      pkg.contributes.grammars.find(({ language }) => language === 'todo').embeddedLanguages
    ).to.deep.equal(generated.embeddedLanguages);
    expect(
      pkg.contributes.grammars.find(({ scopeName }) => scopeName === codeGrammar.scopeName).path
    ).to.equal('./syntax/fenced-code.tmLanguage.json');
  });

  it('recognizes every catalog language and alias with an available TextMate scope', () => {
    const scanner = new OnigScanner(
      codeGrammar.patterns.slice(0, -1).map((rule) => rule.patterns[0].begin)
    );
    for (const { name, aliases, scope } of catalog.languages) {
      if (!scope || scope === 'none') continue;
      for (const alias of [name, name.replace(/\s/g, '-'), ...aliases]) {
        expect(scanner.findNextMatchSync('```' + alias, 0), `${name}: ${alias}`).not.to.equal(null);
      }
    }
    scanner.dispose();
  });

  const tokenize = (text: string) => {
    let state = INITIAL;
    return text.split('\n').map((line) => {
      const result = grammar.tokenizeLine(line, state);
      state = result.ruleStack;
      return result.tokens.reduce((scopes: string[], token) => scopes.concat(token.scopes), []);
    });
  };

  for (const [alias, scope] of [
    ['js', 'javascript'],
    ['JAVASCRIPT', 'javascript'],
    ['ts', 'typescript'],
    ['typescript', 'typescript'],
    ['sql', 'sql'],
    ['py', 'python'],
    ['c++', 'cpp'],
    ['csharp', 'csharp'],
    ['bash', 'shellscript'],
    ['yml', 'yaml'],
    ['rust', 'rust'],
    ['golang', 'go'],
    ['jsx', 'javascriptreact'],
    ['tsx', 'typescriptreact'],
    ['html', 'html'],
    ['terraform', 'source.hcl'],
  ]) {
    it(`embeds ${alias} and resumes Todo scopes after the fence`, () => {
      const scopes = tokenize(`  \`\`\` ${alias}\nconst SELECT\n  \`\`\`\n☐ actual`);
      expect(scopes[1]).to.include(`meta.embedded.block.${scope}`);
      expect(scopes[1].some((name) => name.indexOf('keyword.fixture.') === 0)).to.equal(true);
      expect(scopes[3]).to.include('markup.list.unchecked.todo');
      expect(scopes[3]).not.to.include('markup.fenced_code.block.todo');
    });
  }

  it('closes a fence even inside an unfinished embedded language comment', () => {
    const scopes = tokenize('```ts\n/* unfinished\n```\nProject:');
    expect(scopes[1]).to.include('comment.block.fixture');
    expect(scopes[3]).to.include('markup.heading.todo');
    expect(scopes[3]).not.to.include('comment.block.fixture');
  });

  it('keeps missing grammars literal and resumes Todo highlighting', () => {
    const scopes = tokenize('```elixir\n☐ literal @id(fake)\n```\n☐ actual');
    expect(scopes[1]).to.include('markup.fenced_code.block.todo');
    expect(scopes[1]).not.to.include('markup.list.unchecked.todo');
    expect(scopes[3]).to.include('markup.list.unchecked.todo');
  });

  it('assigns non-Todo language metadata to fallback fences', async () => {
    const embedded = grammar;
    for (const alias of ['unknown', 'elixir', 'js']) {
      const opening = embedded.tokenizeLine2('```' + alias, INITIAL);
      const line = embedded.tokenizeLine2('☐ literal', opening.ruleStack);
      expect(line.tokens[1] & 255, alias).to.equal(alias === 'js' ? 3 : 2);
    }
  });

  it('agrees with the scanner for longer, shorter, unknown and unfinished fences', () => {
    for (const text of [
      '````js\n```\nconst value\n`````\n☐ actual',
      '```unknown\nArchive:\n```\n☐ actual',
      '```\n☐ literal',
      '``` ts\nconst value\n```sql\nArchive:\n```\n☐ actual',
    ]) {
      const scopes = tokenize(text);
      const code = parseCodeBlocks(text);
      scopes.forEach((names, line) => {
        expect(names.includes('markup.fenced_code.block.todo'), `${text}: line ${line}`).to.equal(
          code.byLine.has(line)
        );
      });
    }
  });
});
