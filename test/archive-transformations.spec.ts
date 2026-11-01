import { expect } from 'chai';
import { parseCodeBlocks } from '../src/utils/code-blocks';

const loadArchive = (errors: string[] = []) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    archivePath = require.resolve('../src/utils/archive'),
    astPath = require.resolve('../src/utils/ast'),
    previousArchive = require.cache[archivePath],
    previousAst = require.cache[astPath],
    isProject = (line: string) => /^\s*[^:]+:\s*$/.test(line),
    isTodo = (line: string) => /^\s*[☐✔]/.test(line),
    editor = { getIndentation: () => undefined },
    vscode = {
      window: {
        visibleTextEditors: [],
        showErrorMessage: (message: string) => errors.push(message),
      },
    };

  NodeModule._load = function (request, parent, isMain) {
    if (parent && (parent.filename === archivePath || parent.filename === astPath)) {
      if (request === 'vscode') return vscode;
      if (request === './editor') return { default: editor };
      if (request === '../consts') {
        return {
          default: {
            regexes: { empty: /^\s*$/, projectParts: /^(\s*)([^:]+):/ },
          },
        };
      }
    }
    if (parent && parent.filename === archivePath) {
      if (request === '../todo/items') {
        return {
          Todo: { is: isTodo },
          TodoBox: { is: (line) => /^\s*☐/.test(line) },
          Project: { is: isProject },
          Comment: { is: (line) => !isProject(line) && !isTodo(line) },
        };
      }
      if (request === '../todo/document') return { default: {} };
      if (request === '../config') return { default: { getKey: () => true } };
      if (request === './index') return { default: { tags: { remove: (text) => text } } };
      if (request === './folder') return { default: {} };
      if (request === './archive-storage') return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[archivePath];
    delete require.cache[astPath];
    return require(archivePath).default;
  } finally {
    NodeModule._load = originalLoad;
    if (previousArchive) require.cache[archivePath] = previousArchive;
    else delete require.cache[archivePath];
    if (previousAst) require.cache[astPath] = previousAst;
    else delete require.cache[astPath];
  }
};

const transform = (content: string) => {
  const Archive = loadArchive(),
    lines = content.split('\n').map((text, lineNumber) => ({ text, lineNumber })),
    code = parseCodeBlocks(content),
    doc = {
      textDocument: {
        version: 1,
        lineCount: lines.length,
        getText: () => content,
        lineAt: (lineNumber) => lines[lineNumber],
      },
      getTodosFinished: () =>
        lines
          .filter((line) => !code.byLine.has(line.lineNumber) && /^\s*✔/.test(line.text))
          .map((line) => ({ line })),
      getProjects: () =>
        lines
          .filter((line) => !code.byLine.has(line.lineNumber) && /^\s*[^:]+:\s*$/.test(line.text))
          .map((line) => ({ line })),
    },
    data = { remove: [], insert: {} };

  ['addTodosFinished', 'addTodosComments', 'addProjectHeaders', 'removeEmptyProjects'].forEach(
    (name) => Archive.transformations[name](doc, data)
  );

  return data;
};

describe('Archive transformations', () => {
  it('leaves the document untouched when a fence is unfinished', async () => {
    const errors = [];
    const Archive = loadArchive(errors);
    await Archive.run({ textDocument: { getText: () => '✔ Finished\n```ts\ncode' } });
    expect(errors).to.deep.equal(['Close fenced code blocks before archiving tasks']);
  });
  it('keeps projects containing standalone fenced notes in place', () => {
    const data = transform('Work:\n  ```ts\nArchive:\n  ```\nDone:\n  ✔ Finished');
    expect(data.remove.map((line) => line.lineNumber)).to.deep.equal([5, 4]);
  });
  it('moves attached fences intact, including blank lines and task/project-shaped payload', () => {
    const block = [
      '  ✔ Finished',
      '',
      '  ```ts',
      'Archive:',
      '',
      '',
      '✔ example @project(literal)',
      '  ```',
    ].join('\n');
    const data = transform('Work:\n' + block + '\n  ☐ Pending');
    expect(data.remove.map((line) => line.lineNumber)).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(data.insert[1]).to.deep.equal({ text: block, projects: ['Work'] });
  });
  it('keeps finished task comments in one block with their relative indentation', () => {
    const data = transform('Work:\n  ✔ Finished\n    Attached note\n  ☐ Pending');

    expect(data.remove.map((line) => line.lineNumber)).to.deep.equal([1, 2]);
    expect(data.insert).to.deep.equal({
      1: { text: '  ✔ Finished\n    Attached note', projects: ['Work'] },
    });
  });

  it('preserves standalone notes and the projects containing them', () => {
    const data = transform('Work:\n  Empty:\n    Standalone note\n  Done:\n    ✔ Finished');

    expect(data.remove.map((line) => line.lineNumber)).to.deep.equal([4, 3]);
    expect(data.insert[4]).to.deep.equal({
      text: '    ✔ Finished',
      projects: ['Work', 'Done'],
    });
    expect(data.insert[3]).to.deep.equal({ text: '', projects: ['Work', 'Done'] });
  });

  it('archives complete project paths without overwriting finished task metadata', () => {
    const data = transform('Work:\n  Child:\n    ✔ Finished\n      Attached note');

    expect(data.insert[0]).to.deep.equal({ text: '', projects: ['Work'] });
    expect(data.insert[1]).to.deep.equal({ text: '', projects: ['Work', 'Child'] });
    expect(data.insert[2]).to.deep.equal({
      text: '    ✔ Finished\n      Attached note',
      projects: ['Work', 'Child'],
    });
    expect(data.insert[3]).to.equal(undefined);
  });
});
