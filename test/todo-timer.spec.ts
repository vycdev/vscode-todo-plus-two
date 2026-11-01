import { expect } from 'chai';
import Tags from '../src/utils/tags';

const loadTodo = (configValues) => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    todoPath = require.resolve('../src/todo/items/todo'),
    previousTodo = require.cache[todoPath],
    config = {
      getKey(key: string) {
        return configValues[key];
      },
    },
    consts = {
      regexes: {
        tagStarted: /@started(?:\([^)]*\))?/,
        tagFinished: /@(?:done|cancelled)(?:\([^)]*\))?/,
        tagElapsed: /@(?:lasted|wasted)(?:\([^)]*\))?/,
        todoFinished: /^(?:✔|✘)\s|@(?:done|cancelled)(?:\([^)]*\))?(?![a-zA-Z0-9])/,
        todoDone: /^✔\s|@done(?:\([^)]*\))?(?![a-zA-Z0-9])/,
        todoCancelled: /^✘\s|@cancelled(?:\([^)]*\))?(?![a-zA-Z0-9])/,
      },
      symbols: {
        box: '☐',
        done: '✔',
        cancelled: '✘',
      },
    };

  class Item {
    _line;

    constructor(_textEditor, line) {
      this._line = line;
    }

    get line() {
      return this._line;
    }

    get text() {
      return this.line ? this.line.text : '';
    }

    static is(text: string, regex: RegExp) {
      regex.lastIndex = 0;
      return regex.test(text);
    }
  }

  NodeModule._load = (request: string, parent, isMain: boolean) => {
    if (parent && parent.filename === todoPath) {
      if (request === '../../config') return { default: config };
      if (request === '../../consts') return { default: consts };
      if (request === '../../utils') {
        return {
          default: {
            tags: Tags,
          },
        };
      }
      if (request === './item') return { default: Item };
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    delete require.cache[todoPath];
    return require('../src/todo/items/todo').default;
  } finally {
    NodeModule._load = originalLoad;
    if (previousTodo) {
      require.cache[todoPath] = previousTodo;
    } else {
      delete require.cache[todoPath];
    }
  }
};

describe('Todo timer completion', () => {
  it('calculates elapsed time before configured toggle-tag cleanup', () => {
    const Todo = loadTodo({
        'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
        'timekeeping.finished.remove.tags': ['toggle'],
        'timekeeping.finished.enabled': true,
        'timekeeping.finished.time': false,
        'timekeeping.elapsed.enabled': true,
        'timekeeping.elapsed.format': 'short-compact',
        hoursPerDay: 24,
        manHoursPerDay: 8,
        manDaysPerWeek: 5,
      }),
      line = {
        text: '☐ Task @started(2026-08-08 06:00:00) @toggle(2026-08-08 06:30:00) @paused',
      },
      todo = new Todo(null, line);

    todo.finish(true);

    expect(todo.lineNextText).to.not.include('@toggle');
    expect(todo.lineNextText).to.not.include('@paused');
    expect(todo.lineNextText).to.include('@done');
    expect(todo.lineNextText).to.include('@lasted(30m)');
  });

  it('updates timing history and the styling marker together on pause and resume', () => {
    const Todo = loadTodo({ 'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss' }),
      todo = new Todo(null, { text: '☐ Task @started(2026-08-02 10:00:00)' });

    todo.toggleTimer(new Date(2026, 7, 2, 10, 30));
    expect(todo.lineNextText).to.equal(
      '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @paused'
    );
    todo.toggleTimer(new Date(2026, 7, 2, 11, 0));
    expect(todo.lineNextText).to.equal(
      '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @toggle(2026-08-02 11:00:00)'
    );
  });

  it('clears the marker when unstarting or starting a new timer', () => {
    const Todo = loadTodo({
      'timekeeping.started.time': false,
      'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
    });
    const restarting = new Todo(null, { text: '☐ Task @paused' });
    restarting.start();
    expect(restarting.lineNextText).to.equal('☐ Task @started');

    const stopping = new Todo(null, { text: '☐ Task @started(2026-08-02 10:00:00) @paused' });
    stopping.unstart();
    expect(stopping.lineNextText).to.equal('☐ Task');
  });

  it('repairs markers from edited history without changing timing tags', () => {
    const Todo = loadTodo({ 'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss' }),
      todo = new Todo(null, {
        text: '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00)',
      });
    todo.syncPausedTag(new Date(2026, 7, 2, 12, 0));
    expect(todo.lineNextText).to.equal(
      '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @paused'
    );
  });

  it('deduplicates paused markers and preserves code examples and task identity', () => {
    const Todo = loadTodo({ 'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss' }),
      initial =
        '☐ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00) @id(@paused) @depends(@paused) `@paused`',
      todo = new Todo(null, { text: `${initial} @paused @paused` });
    todo.syncPausedTag(new Date(2026, 7, 2, 12, 0));
    expect(todo.lineNextText).to.equal(`${initial} @paused`);
    todo.syncPausedTag(new Date(2026, 7, 2, 12, 0));
    expect(todo.lineNextText).to.equal(`${initial} @paused`);
  });

  it('ignores invalid, future and out-of-order toggles when repairing markers', () => {
    const Todo = loadTodo({ 'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss' }),
      todo = new Todo(null, {
        text: '☐ Task @started(2026-08-02 10:00:00) @toggle(invalid) @toggle(2026-08-02 09:00:00) @toggle(2026-08-02 13:00:00) @paused',
      });
    todo.syncPausedTag(new Date(2026, 7, 2, 12, 0));
    expect(todo.lineNextText).not.to.include('@paused');
  });

  it('clears markers from finished and timestamp-free tasks', () => {
    const Todo = loadTodo({ 'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss' });
    for (const text of [
      '✔ Task @started(2026-08-02 10:00:00) @toggle(2026-08-02 10:30:00)',
      '☐ Task @started',
      '☐ Task',
    ]) {
      const todo = new Todo(null, { text: `${text} @paused` });
      todo.syncPausedTag(new Date(2026, 7, 2, 12, 0));
      expect(todo.lineNextText).to.equal(text);
    }
  });

  it('preserves literal paused references during start, unstart, repair and completion', () => {
    const Todo = loadTodo({
      'timekeeping.started.time': false,
      'timekeeping.started.format': 'YYYY-MM-DD HH:mm:ss',
      'timekeeping.finished.enabled': true,
      'timekeeping.finished.time': false,
    });
    const metadata = '@id(@paused) @depends(@paused) @note(@paused)';
    for (const action of ['start', 'unstart', 'syncPausedTag', 'finish']) {
      const todo = new Todo(null, { text: `☐ Task ${metadata} @paused` });
      todo[action]();
      expect(todo.lineNextText, action).to.include(metadata);
      expect(todo.lineNextText, action).not.to.match(/\s@paused(?:\s|$)/);
    }
  });
});
