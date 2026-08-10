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
                text: '☐ Task @started(2026-08-08 06:00:00) @toggle(2026-08-08 06:30:00)',
            },
            todo = new Todo(null, line);

        todo.finish(true);

        expect(todo.lineNextText).to.not.include('@toggle');
        expect(todo.lineNextText).to.include('@done');
        expect(todo.lineNextText).to.include('@lasted(30m)');
    });
});
