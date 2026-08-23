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
                timer: { statusbar: { color: '' } },
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
        command: { get: () => 'todo.open' },
        statistics: { timeTags: { parseEstimate: () => 0 } },
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
                    timer: true,
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
});
