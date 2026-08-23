import { expect } from 'chai';

function loadStatistics(settings) {
    const NodeModule = require('module');
    const originalLoad = NodeModule._load;
    const statusItems = [];
    const config = {
        getKey(key) {
            return settings[key];
        },
        get() {
            return {
                statistics: {
                    statusbar: {
                        alignment: settings.alignment,
                        priority: settings.priority,
                        enabled: true,
                        color: '',
                        command: '',
                        text: '',
                        tooltip: '',
                    },
                },
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
                    show() {},
                    hide() {},
                    dispose() {
                        this.disposed = true;
                    },
                };
                statusItems.push(item);
                return item;
            },
            activeTextEditor: {},
        },
    };
    const utils = {
        editor: { isSupported: () => true },
        statistics: {
            tokens: { global: {} },
            condition: { is: () => true },
            template: { render: (value) => value },
        },
    };
    const subjectPath = require.resolve('../src/statusbars/statistics');
    const cached = require.cache[subjectPath];

    NodeModule._load = function (request, parent, isMain) {
        if (request === 'vscode') return vscode;
        if (request === '../config') return { default: config };
        if (request === '../utils') return { default: utils };

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

describe('Status bar layout settings', () => {
    it('applies alignment and priority changes to the live statistics item', () => {
        const settings = {
            alignment: 'left',
            priority: 1,
            'statistics.statusbar.alignment': 'left',
            'statistics.statusbar.priority': 1,
            'statistics.statusbar.enabled': true,
        };
        const { instance, statusItems } = loadStatistics(settings);

        settings.alignment = 'right';
        settings.priority = 42;
        settings['statistics.statusbar.alignment'] = 'right';
        settings['statistics.statusbar.priority'] = 42;
        instance.update();

        expect(statusItems).to.have.length(2);
        expect(statusItems[0].disposed).to.equal(true);
        expect(statusItems[1].alignment).to.equal('right');
        expect(statusItems[1].priority).to.equal(42);
    });
});
