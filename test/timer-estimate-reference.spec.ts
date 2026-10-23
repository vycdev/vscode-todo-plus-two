import { expect } from 'chai';
import Time from '../src/utils/time';

const withClock = (initial: Date, run: (advance: (milliseconds: number) => void) => void) => {
  const OriginalDate = Date;
  let now = initial.getTime();

  global.Date = class extends OriginalDate {
    constructor(...args: any[]) {
      super(now);
      return Reflect.construct(OriginalDate, args.length ? args : [now], new.target);
    }

    static now() {
      return now;
    }
  } as DateConstructor;

  try {
    run((milliseconds) => {
      now += milliseconds;
    });
  } finally {
    global.Date = OriginalDate;
  }
};

const loadTimer = (startedFormat = 'YYYY-MM-DD HH:mm:ss') => {
  const NodeModule = require('module'),
    originalLoad = NodeModule._load,
    timerPath = require.resolve('../src/statusbars/timer'),
    statisticsPath = require.resolve('../src/utils/statistics'),
    tokensPath = require.resolve('../src/utils/statistics_tokens'),
    isolatedPaths = [timerPath, statisticsPath, tokensPath],
    previousModules = isolatedPaths.map((filename) => require.cache[filename]),
    config = {
      getKey: (key: string) => (key === 'manDaysPerWeek' ? 5 : 8),
      get: () => ({
        timekeeping: { started: { format: startedFormat } },
        timer: { statusbar: { color: '' } },
      }),
    },
    consts = {
      timer: true,
      regexes: {
        tagStarted: /@started\([^)]*\)/,
        tagEstimate: /@est\([^)]*\)/,
      },
    },
    vscode = {
      StatusBarAlignment: { Left: 1, Right: 2 },
      window: {
        createStatusBarItem: () => ({
          show: () => undefined,
          hide: () => undefined,
          dispose: () => undefined,
        }),
      },
    };

  let statistics;

  try {
    NodeModule._load = (request, parent, isMain) => {
      if (parent && isolatedPaths.indexOf(parent.filename) >= 0) {
        if (request === 'vscode') return vscode;
        if (request === '../config') return { default: config };
        if (request === '../consts') return { default: consts };
        if (request === '../todo/items' || request === './ast') return {};
        if (request === '../todo/document') return { default: class {} };
        if (request === '../utils') {
          return {
            default: {
              statistics,
              time: Time,
              command: { get: (command, args) => ({ command, arguments: args }) },
            },
          };
        }
      }

      return originalLoad(request, parent, isMain);
    };
    isolatedPaths.forEach((filename) => delete require.cache[filename]);
    statistics = require(statisticsPath).default;
    return require(timerPath).default;
  } finally {
    NodeModule._load = originalLoad;
    isolatedPaths.forEach((filename, index) => {
      delete require.cache[filename];
      if (previousModules[index]) require.cache[filename] = previousModules[index];
    });
  }
};

const createDocument = (estimate: string, started = '2026-10-23 12:00:00') => {
  const todo = {
    text: `Task @started(${started}) ${estimate}`,
    line: { lineNumber: 0 },
    getTag(regex: RegExp) {
      const match = this.text.match(regex);

      return match ? match[0] : undefined;
    },
  };

  return {
    todo,
    document: {
      textDocument: { uri: { fsPath: '/workspace/countdown.todo' } },
      getTodosBoxStarted: () => [todo],
    },
  };
};

describe('Timer estimate reference dates', () => {
  for (const estimate of ['@est(2026-10-23 14:00)', '@est(2h)']) {
    it(`keeps the ${estimate} countdown unchanged when an active task is edited`, () => {
      withClock(new Date(2026, 9, 23, 12), (advance) => {
        const timer = loadTimer(),
          { todo, document } = createDocument(estimate);

        try {
          timer.update(document);
          expect(timer.item.text).to.equal('2:00:00');

          advance(30 * 60 * 1000);
          timer.updateText();
          expect(timer.item.text).to.equal('1:30:00');

          todo.text = todo.text.replace('Task', 'Renamed task');
          timer.update(document);
          expect(timer.item.text).to.equal('1:30:00');
        } finally {
          timer.dispose();
        }
      });
    });
  }

  it('uses the task start when a calendar countdown is first opened later', () => {
    withClock(new Date(2026, 9, 23, 12, 30), () => {
      const timer = loadTimer(),
        { document } = createDocument('@est(2026-10-23 14:00)');

      try {
        timer.update(document);
        expect(timer.item.text).to.equal('1:30:00');
      } finally {
        timer.dispose();
      }
    });
  });

  it('preserves the original sub-minute offset when refreshing a calendar countdown', () => {
    withClock(new Date(2026, 9, 23, 12, 0, 15), (advance) => {
      const timer = loadTimer('YYYY-MM-DD HH:mm'),
        { todo, document } = createDocument('@est(2026-10-23 14:00)', '2026-10-23 12:00');

      try {
        timer.update(document);
        expect(timer.data.timestampOffset).to.equal(15000);
        expect(timer.item.text).to.equal('1:59:45');

        advance((30 * 60 + 5) * 1000);
        timer.updateText();
        expect(timer.item.text).to.equal('1:29:40');

        todo.text = todo.text.replace('Task', 'Renamed task');
        timer.update(document);
        expect(timer.data.timestampOffset).to.equal(15000);
        expect(timer.item.text).to.equal('1:29:40');
      } finally {
        timer.dispose();
      }
    });
  });
});
