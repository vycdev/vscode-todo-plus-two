const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'syntax/code-languages.json');

// Linguist and VS Code occasionally use different root scopes or language IDs.
// These overrides use VS Code's bundled grammars; other languages retain their
// Linguist scope and can be supplied by an installed language extension.
const overrides = {
  'C++': ['source.cpp', 'cpp'],
  'C#': ['source.cs', 'csharp'],
  'F#': ['source.fsharp', 'fsharp'],
  HTML: ['text.html.derivative', 'html'],
  Markdown: ['text.html.markdown', 'markdown'],
  'Objective-C++': ['source.objcpp', 'objective-cpp'],
  'Objective-C': ['source.objc', 'objective-c'],
  'Visual Basic .NET': ['source.asp.vb.net', 'vb'],
  WebAssembly: ['text.wat', 'wat'],
  Less: ['source.css.less', 'less'],
  SCSS: ['source.css.scss', 'scss'],
  Pug: ['text.pug', 'jade'],
  Raku: ['source.perl.6', 'raku'],
};

const languageIds = {
  'source.batchfile': 'bat',
  'source.clojure': 'clojure',
  'source.coffee': 'coffeescript',
  'source.c': 'c',
  'source.css': 'css',
  'source.dart': 'dart',
  'source.diff': 'diff',
  'source.dockerfile': 'dockerfile',
  'source.go': 'go',
  'source.groovy': 'groovy',
  'text.html.handlebars': 'handlebars',
  'source.hlsl': 'hlsl',
  'source.ini': 'ini',
  'source.java': 'java',
  'source.js': 'javascript',
  'source.js.jsx': 'javascriptreact',
  'source.json': 'json',
  'source.json.comments': 'jsonc',
  'source.julia': 'julia',
  'text.tex': 'tex',
  'text.tex.latex': 'latex',
  'text.bibtex': 'bibtex',
  'source.lua': 'lua',
  'source.makefile': 'makefile',
  'source.perl': 'perl',
  'text.html.php': 'php',
  'source.php': 'php',
  'source.powershell': 'powershell',
  'source.python': 'python',
  'source.r': 'r',
  'source.rst': 'restructuredtext',
  'source.ruby': 'ruby',
  'source.rust': 'rust',
  'source.shell': 'shellscript',
  'source.sql': 'sql',
  'source.swift': 'swift',
  'source.ts': 'typescript',
  'source.tsx': 'typescriptreact',
  'text.xml': 'xml',
  'text.xml.xsl': 'xsl',
  'source.yaml': 'yaml',
};

// Widely used VS Code fence identifiers that are not separate Linguist entries.
const additionalLanguages = [{ name: 'JSX', aliases: ['javascriptreact'], scope: 'source.js.jsx' }];
Object.values(overrides).forEach(([scope, languageId]) => {
  languageIds[scope] = languageId;
});

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createCodeGrammar = (catalog) => {
  const groups = new Map();
  const embeddedLanguages = {
    'meta.embedded.block': 'plaintext',
    'markup.raw.block.todo': 'plaintext',
  };
  catalog.languages.concat(additionalLanguages).forEach(({ name, aliases, scope }) => {
    if (!scope || scope === 'none') return;
    const [targetScope, languageId] = overrides[name] || [scope, languageIds[scope]];
    const contentName = `meta.embedded.block.${languageId || targetScope}`;
    if (languageId) embeddedLanguages[contentName] = languageId;
    if (!groups.has(targetScope)) groups.set(targetScope, { contentName, aliases: new Set() });
    const group = groups.get(targetScope);
    [name, name.replace(/\s/g, '-'), ...aliases].forEach((alias) =>
      group.aliases.add(alias.toLowerCase())
    );
  });

  const patterns = Array.from(groups.entries()).map(([scope, group]) => {
    const aliases = Array.from(group.aliases).sort(
      (left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0)
    );
    const header = `^[\\t ]*(\`{3,})[\\t ]*(?i:${aliases.map(escapeRegExp).join('|')})[\\t ]*$`;
    return {
      begin: header.replace('^', '^(?=') + ')',
      end: '^[\\t ]*\\1`*[\\t ]*$',
      applyEndPatternLast: true,
      name: 'markup.fenced_code.block.todo',
      patterns: [
        {
          begin: header,
          while: '^(?![\\t ]*\\1`*[\\t ]*$)',
          contentName: group.contentName,
          patterns: [{ include: scope }],
        },
      ],
    };
  });
  patterns.push({
    begin: '^[\\t ]*(`{3,})[^`\\r\\n]*$',
    end: '^[\\t ]*\\1`*[\\t ]*$',
    name: 'markup.fenced_code.block.todo',
    contentName: 'markup.raw.block.todo',
  });
  return {
    grammar: { name: 'Todo fenced code', scopeName: 'text.todo.fenced', patterns },
    embeddedLanguages,
  };
};

const formatJson = async (source, filepath) =>
  prettier.format(source, { ...(await prettier.resolveConfig(filepath)), filepath });
const writeJson = async (file, value) =>
  fs.writeFileSync(file, await formatJson(JSON.stringify(value, null, 2), file));

const updateCatalog = async (revision) => {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Pass a full Linguist commit SHA to --update');
  const base = `https://raw.githubusercontent.com/github-linguist/linguist/${revision}`;
  const download = async (file) => {
    const response = await fetch(`${base}/${file}`);
    if (!response.ok) throw new Error(`Cannot download ${file}: HTTP ${response.status}`);
    return response.text();
  };
  const languages = require('js-yaml').load(await download('lib/linguist/languages.yml'));
  await writeJson(catalogPath, {
    source: `https://github.com/github-linguist/linguist/blob/${revision}/lib/linguist/languages.yml`,
    license: 'linguist-LICENSE.txt',
    languages: Object.entries(languages).map(([name, data]) => ({
      name,
      aliases: data.aliases || [],
      scope: data.tm_scope || 'none',
    })),
  });
  fs.writeFileSync(path.join(root, 'syntax/linguist-LICENSE.txt'), await download('LICENSE'));
};

const generate = async () => {
  if (process.argv[2] === '--update') await updateCatalog(process.argv[3] || '');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const { grammar, embeddedLanguages } = createCodeGrammar(catalog);
  await writeJson(path.join(root, 'syntax/fenced-code.tmLanguage.json'), grammar);
  const manifestPath = path.join(root, 'package.json');
  const manifestSource = fs
    .readFileSync(manifestPath, 'utf8')
    .replace(
      /"embeddedLanguages": \{[^}]*\}/,
      `"embeddedLanguages": ${JSON.stringify(embeddedLanguages, null, 2)}`
    );
  fs.writeFileSync(manifestPath, await formatJson(manifestSource, manifestPath));
  process.stdout.write(
    `Generated ${grammar.patterns.length - 1} grammar mappings from ${catalog.languages.length} Linguist languages.\n`
  );
};

module.exports = { createCodeGrammar };
if (require.main === module)
  generate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
