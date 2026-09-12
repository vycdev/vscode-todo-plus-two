import { expect } from 'chai';
import {
  countPendingTodos,
  getActivityBarBadge,
  supportsActivityBarBadge,
  updateActivityBarBadge,
} from '../src/utils/activity-bar-badge';

const document = (lines: string[]) => ({
  lineCount: lines.length,
  lineAt: (lineNumber: number) => ({ text: lines[lineNumber] }),
});

describe('Activity bar badge', () => {
  it('does not update a disposed tree view after an asynchronous file load', async () => {
    const NodeModule = require('module'),
      originalLoad = NodeModule._load,
      filesPath = require.resolve('../src/views/files'),
      viewPath = require.resolve('../src/views/view'),
      previousFiles = require.cache[filesPath],
      previousView = require.cache[viewPath];
    let finishLoad: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    const treeView = { badge: undefined };
    NodeModule._load = (request, parent, isMain) => {
      if (request === 'vscode')
        return {
          EventEmitter: class {
            event = () => undefined;
            fire() {}
            dispose() {}
          },
        };
      if (request === '../config') return { default: { get: () => ({ file: { view: {} } }) } };
      if (request === '../consts') return { default: { regexes: { todoBox: /^pending/ } } };
      if (request === '../utils')
        return {
          default: {
            files: {
              get: () => loading,
              filesData: { '/workspace/TODO': { textEditor: document(['pending task']) } },
            },
          },
        };
      if (request.startsWith('./items/')) return { default: class Item {} };
      if (request === '../utils/tags') return { default: {} };
      return originalLoad(request, parent, isMain);
    };

    try {
      delete require.cache[filesPath];
      delete require.cache[viewPath];
      const view = require(filesPath).default;
      view.setTreeView(treeView);
      const refresh = view.refreshActivityBarBadge();
      view.dispose();
      finishLoad();
      await refresh;
      expect(treeView.badge).to.equal(undefined);
    } finally {
      finishLoad();
      NodeModule._load = originalLoad;
      delete require.cache[filesPath];
      delete require.cache[viewPath];
      if (previousFiles) require.cache[filesPath] = previousFiles;
      if (previousView) require.cache[viewPath] = previousView;
    }
  });

  it('counts pending todos across loaded Todo files', () => {
    const filesData = {
      '/workspace/TODO': {
        textEditor: document(['Project:', '  ☐ first', '  ✔ done']),
      },
      '/workspace/next.todo': {
        textEditor: document(['☐ second', 'A comment']),
      },
      '/workspace/loading.todo': undefined,
    };

    expect(countPendingTodos(filesData, /^\s*☐\s/)).to.equal(2);
  });

  it('creates a singular or plural badge and hides zero', () => {
    expect(getActivityBarBadge(0)).to.equal(undefined);
    expect(getActivityBarBadge(1)).to.deep.equal({
      value: 1,
      tooltip: '1 pending todo',
    });
    expect(getActivityBarBadge(2)).to.deep.equal({
      value: 2,
      tooltip: '2 pending todos',
    });
  });

  it('counts unfinished tasks with completion-tag examples inside inline code', () => {
    const filesData = {
      '/workspace/TODO': {
        textEditor: document([
          '☐ explain `@done`',
          '☐ explain ``@cancelled``',
          '☐ actually finished @done',
          '☐ actually cancelled @cancelled',
        ]),
      },
    };
    expect(countPendingTodos(filesData, /^\s*☐\s(?!.*@(?:done|cancelled)).*/gm)).to.equal(2);
  });

  it('updates supported tree views without affecting older VS Code versions', () => {
    const supported = { badge: undefined };
    const unsupported = {};

    expect(supportsActivityBarBadge(supported)).to.equal(true);
    expect(supportsActivityBarBadge(unsupported)).to.equal(false);
    expect(updateActivityBarBadge(supported, 2)).to.equal(true);
    expect(supported.badge).to.deep.equal({ value: 2, tooltip: '2 pending todos' });
    expect(updateActivityBarBadge(supported, 0)).to.equal(true);
    expect(supported.badge).to.equal(undefined);
    expect(updateActivityBarBadge(unsupported, 2)).to.equal(false);
    expect(unsupported).to.deep.equal({});
  });
});
