import { expect } from 'chai';

function loadTimer(settings) {
  const NodeModule = require('module');
  const originalLoad = NodeModule._load;
  const statusItems = [];
  const config = {
    getKey(key) {
      return settings[key];
    },
    get() {
      return {
        timekeeping: { started: { format: 'YY-MM-DD HH:mm' } },
        timer: { statusbar: { color: settings['timer.statusbar.color'] || '' } },
      };
    },
  };
  const vscode = {
    StatusBarAlignment: { Left: 'left', Right: 'right' },
    window: {
      createStatusBarItem(alignment, priority) {
        const item = {
          alignment,
          priority,
          show() {
            this.visible = true;
          },
          hide() {
            this.visible = false;
          },
          dispose() {
            this.disposed = true;
          },
        };
        statusItems.push(item);
        return item;
      },
    },
  };
  const utils = {
    command: { get: (command, args) => ({ command, arguments: args }) },
    statistics: { timeTags: { parseEstimate: (tag) => Number(tag.match(/\d+/)[0]) * 60 } },
    time: { diffClock: () => '0:01' },
  };
  const subjectPath = require.resolve('../src/statusbars/timer');
  const cached = require.cache[subjectPath];

  NodeModule._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request === '../config') return { default: config };
    if (request === '../consts') {
      return {
        default: {
          get timer() {
            return settings['timer.statusbar.enabled'] !== false;
          },
          regexes: { tagStarted: /@started/, tagEstimate: /@est/ },
        },
      };
    }
    if (request === '../todo/document') return { default: class Document {} };
    if (request === '../utils') return { default: utils };
    if (request === '../utils/timekeeping') {
      return { getTimerState: () => ({ active: true, elapsedMilliseconds: 1000 }) };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[subjectPath];
    return { instance: require(subjectPath).default, statusItems };
  } finally {
    NodeModule._load = originalLoad;
    delete require.cache[subjectPath];
    if (cached) require.cache[subjectPath] = cached;
  }
}

describe('Timer status bar layout settings', () => {
  it('applies alignment and priority changes while the active timer is unchanged', () => {
    const settings = {
      'timer.statusbar.alignment': 'left',
      'timer.statusbar.priority': 1,
    };
    const { instance, statusItems } = loadTimer(settings);
    const todo = {
      text: '☐ Active @started(26-08-21 01:00)',
      line: { lineNumber: 3 },
      getTag: () => '@started(26-08-21 01:00)',
    };
    const document = {
      textDocument: { uri: { fsPath: '/workspace/TODO' } },
      getTodosBoxStarted: () => [todo],
    };

    instance.update(document);
    settings['timer.statusbar.alignment'] = 'right';
    settings['timer.statusbar.priority'] = 42;
    instance.update(document);
    clearInterval(instance.intervalId);

    expect(statusItems).to.have.length(2);
    expect(statusItems[0].disposed).to.equal(true);
    expect(statusItems[1].alignment).to.equal('right');
    expect(statusItems[1].priority).to.equal(42);
    expect(statusItems[1].visible).to.equal(true);
    expect(statusItems[1].text).to.equal('0:01');
  });

  it('updates the open target for identical tasks in different documents', () => {
    const { instance } = loadTimer({});
    const todo = {
      text: 'Active @started(26-08-21 01:00)',
      line: { lineNumber: 3 },
      getTag: (regex) => (regex.source === '@started' ? '@started(26-08-21 01:00)' : undefined),
    };
    const document = (filePath) => ({
      textDocument: { uri: { fsPath: filePath } },
      getTodosBoxStarted: () => [todo],
    });

    try {
      instance.update(document('/workspace/first.todo'));
      instance.update(document('/workspace/second.todo'));

      expect(instance.data.filePath).to.equal('/workspace/second.todo');
      expect(instance.item.command.arguments).to.deep.equal(['/workspace/second.todo', 3]);
    } finally {
      instance.dispose();
    }
  });

  it('applies estimate edits and settings without resetting timer precision', () => {
    const settings = { 'timer.statusbar.color': 'red', 'timer.statusbar.enabled': true };
    const { instance } = loadTimer(settings);
    let estimate = '@est(10m)';
    const todo = {
      text: 'Active @started(26-08-21 01:00) @est(10m)',
      line: { lineNumber: 3 },
      getTag: (regex) => (regex.source === '@started' ? '@started(26-08-21 01:00)' : estimate),
    };
    const document = {
      textDocument: { uri: { fsPath: '/workspace/TODO' } },
      getTodosBoxStarted: () => [todo],
    };

    try {
      instance.update(document);
      const offset = instance.data.timestampOffset;
      expect(instance.data.estMilliseconds).to.equal(600000);

      estimate = '@est(20m)';
      todo.text = todo.text.replace('10m', '20m');
      instance.update(document);
      expect(instance.data.estMilliseconds).to.equal(1200000);
      expect(instance.data.timestampOffset).to.equal(offset);

      estimate = undefined;
      todo.text = todo.text.replace(' @est(20m)', '');
      settings['timer.statusbar.color'] = 'blue';
      instance.update(document);
      expect(instance.data.estMilliseconds).to.equal(undefined);
      expect(instance.item.color).to.equal('blue');

      settings['timer.statusbar.enabled'] = false;
      instance.update(document);
      expect(instance.item.visible).to.equal(false);
      expect(instance.intervalId).to.equal(undefined);
    } finally {
      instance.dispose();
    }
  });

  it('stops and disposes an active timer', () => {
    const { instance } = loadTimer({});
    instance.update({
      textDocument: { uri: { fsPath: '/workspace/TODO' } },
      getTodosBoxStarted: () => [
        {
          text: 'Active @started(26-08-21 01:00)',
          line: { lineNumber: 1 },
          getTag: () => undefined,
        },
      ],
    });
    expect(instance.intervalId).not.to.equal(undefined);
    instance.dispose();
    expect(instance.intervalId).to.equal(undefined);
    expect(instance.item.disposed).to.equal(true);
  });
});
