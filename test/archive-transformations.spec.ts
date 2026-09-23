import { expect } from 'chai';

const loadArchive = () => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    archivePath = require.resolve('../src/utils/archive'),
    astPath = require.resolve('../src/utils/ast'),
    previousArchive = require.cache[archivePath],
    previousAst = require.cache[astPath],
    isProject = (line: string) => /^\s*[^:]+:\s*$/.test(line),
    isTodo = (line: string) => /^\s*[☐✔]/.test(line),
    editor = { getIndentation: () => undefined },
    vscode = { window: { visibleTextEditors: [] } };

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

const transform = (
  content: string,
  options: { archiveLine?: number; emptyLines?: number } = {}
) => {
  const Archive = loadArchive(),
    lines = content.split('\n').map((text, lineNumber) => ({ text, lineNumber })),
    doc = {
      textDocument: {
        version: 1,
        lineCount: lines.length,
        getText: () => content,
        lineAt: (lineNumber) => lines[lineNumber],
      },
      getTodosFinished: () =>
        lines.filter((line) => /^\s*✔/.test(line.text)).map((line) => ({ line })),
      getProjects: () =>
        lines.filter((line) => /^\s*[^:]+:\s*$/.test(line.text)).map((line) => ({ line })),
      getArchive: () => undefined,
    },
    data = {
      remove: [],
      insert: {},
      archiveLine: options.archiveLine,
    };

  const mockConfig = require.cache[require.resolve('../src/config')]?.exports?.default;
  if (mockConfig) {
    mockConfig.getKey = (key: string) => {
      if (key === 'archive.remove.emptyLines') return options.emptyLines ?? 1;
      if (key === 'archive.remove.emptyProjects') return true;
      if (key === 'archive.remove.tags') return ['today'];
      if (key === 'archive.sortByDate') return false;
      if (key === 'archive.project.enabled') return true;
      if (key === 'archive.project.separator') return '.';
      if (key === 'timekeeping.finished.format') return 'YY-MM-DD HH:mm';
      return true;
    };
  }

  [
    'addTodosFinished',
    'addTodosComments',
    'addProjectHeaders',
    'removeEmptyProjects',
    'removeEmptyLines',
  ].forEach((name) => Archive.transformations[name](doc, data));

  return data;
};

describe('Archive transformations', () => {
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
    const data = transform('Work:\n  Child:\n    ✔ Finished\n      Attached note', {
      archiveLine: 4,
    });

    expect(data.insert[0]).to.deep.equal({ text: '', projects: ['Work'] });
    expect(data.insert[1]).to.deep.equal({ text: '', projects: ['Work', 'Child'] });
    expect(data.insert[2]).to.deep.equal({
      text: '    ✔ Finished\n      Attached note',
      projects: ['Work', 'Child'],
    });
    expect(data.insert[3]).to.equal(undefined);
  });

  it('preserves all trailing empty lines before archive regardless of emptyLines limit', () => {
    // All empty lines at the end are considered the "trailing separator" and preserved
    // Line 0: Project header
    // Line 1: Active task
    // Line 2: Empty
    // Line 3: Empty
    // Line 4: Empty
    // Line 5: Empty
    // Line 6: Empty
    // Archive header at line 7
    const content = 'Work:\n  ☐ Active\n\n\n\n\n\n';
    const data = transform(content, { archiveLine: 7, emptyLines: 1 });

    // No finished tasks to remove
    expect(data.remove.map((line) => line.lineNumber)).to.deep.equal([]);
    // ALL trailing empty lines (2-6) are preserved as the separator
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(2);
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(3);
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(4);
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(5);
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(6);
  });

  it('removes excess empty lines before the trailing separator block', () => {
    // Empty lines before the last active task are subject to emptyLines limit
    // Line 0: Project header
    // Line 1: Empty (excess)
    // Line 2: Empty (excess)
    // Line 3: Active task
    // Line 4: Empty (trailing separator start)
    // Line 5: Empty (trailing separator)
    // Archive header at line 6
    const content = 'Work:\n\n\n  ☐ Active\n\n';
    const data = transform(content, { archiveLine: 6, emptyLines: 1 });

    // No finished tasks to remove initially
    // But removeEmptyLines will remove excess empty line at line 2
    expect(data.remove.map((line) => line.lineNumber)).to.deep.equal([2]);
    // Trailing empty lines (4, 5) preserved
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(4);
    expect(data.remove.map((line) => line.lineNumber)).to.not.include(5);
  });
});
