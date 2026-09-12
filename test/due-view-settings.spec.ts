import { expect } from 'chai';

const loadDueView = (configuredSoonDays: number) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    dueViewPath = require.resolve('../src/views/due'),
    previousDueView = require.cache[dueViewPath];
  let receivedSoonDays;
  let rollover: () => void;
  const originalSetTimeout = global.setTimeout;

  class View {
    config = {};
    refresh() {}
    dispose() {}
  }

  class Placeholder {
    constructor(public label: string) {}
  }

  const vscode = {
      EventEmitter: class {
        listeners: (() => void)[] = [];
        event = (listener: () => void) => {
          this.listeners.push(listener);
          return {
            dispose: () => {
              this.listeners = this.listeners.filter((entry) => entry !== listener);
            },
          };
        };
        fire() {
          this.listeners.forEach((listener) => listener());
        }
        dispose() {
          this.listeners = [];
        }
      },
      TreeItemCollapsibleState: { Expanded: 1, Collapsed: 2 },
    },
    config = { getKey: () => configuredSoonDays },
    utils = {
      files: {
        get: async () => undefined,
        filesData: {
          '/workspace/TODO': {
            relativePath: 'TODO',
            textEditor: {
              lineCount: 1,
              lineAt: () => ({ lineNumber: 0, text: '☐ Later @due(2026-07-10)' }),
            },
          },
        },
      },
    };

  NodeModule._load = (request: string, parent, isMain: boolean) => {
    if (request === 'vscode') return vscode;
    if (request === '../config' && parent.filename === dueViewPath) return { default: config };
    if (request === '../consts' && parent.filename === dueViewPath) {
      return { default: { regexes: { todo: /☐/, todoFinished: /✔|✘/ } } };
    }
    if (request === '../utils' && parent.filename === dueViewPath) return { default: utils };
    if (request === '../utils/due_tasks' && parent.filename === dueViewPath) {
      return {
        getDueDateKey: () => '2026-07-02',
        getDueTaskLines: (_lines, _todo, _finished, _today, soonDays) => {
          receivedSoonDays = soonDays;
          return [];
        },
      };
    }
    if (request === './items/group' && parent.filename === dueViewPath)
      return { default: class {} };
    if (request === './items/item' && parent.filename === dueViewPath) return { default: class {} };
    if (request === './items/placeholder' && parent.filename === dueViewPath) {
      return { default: Placeholder };
    }
    if (request === './items/todo' && parent.filename === dueViewPath) return { default: class {} };
    if (request === './view' && parent.filename === dueViewPath) return { default: View };

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    global.setTimeout = ((callback) => {
      rollover = callback;
      return undefined;
    }) as any;
    delete require.cache[dueViewPath];
    const dueView = require(dueViewPath).Due;
    clearTimeout(dueView.rolloverTimer);

    return { dueView, rollover: () => rollover(), getReceivedSoonDays: () => receivedSoonDays };
  } finally {
    global.setTimeout = originalSetTimeout;
    NodeModule._load = originalLoad;
    if (previousDueView) {
      require.cache[dueViewPath] = previousDueView;
    } else {
      delete require.cache[dueViewPath];
    }
  }
};

describe('Due view settings', () => {
  it('honors a zero-day soon window', async () => {
    const { dueView, getReceivedSoonDays } = loadDueView(0);

    await dueView.getChildren();

    expect(getReceivedSoonDays()).to.equal(0);
  });

  it('notifies editor decoration listeners at the next date rollover', () => {
    const { dueView, rollover } = loadDueView(7);
    let refreshes = 0;
    const subscription = dueView.onDidChangeDate(() => refreshes++);

    try {
      rollover();
      expect(refreshes).to.equal(1);
    } finally {
      subscription.dispose();
      dueView.dispose();
    }
  });
});
