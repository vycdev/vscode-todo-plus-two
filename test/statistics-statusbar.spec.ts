import { expect } from 'chai';

const loadStatistics = (config) => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        statisticsPath = require.resolve('../src/statusbars/statistics'),
        previousStatistics = require.cache[statisticsPath],
        item = {
            text: '',
            tooltip: '',
            show: () => undefined,
            hide: () => undefined,
        };

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') {
            return {
                StatusBarAlignment: { Left: 1, Right: 2 },
                window: {
                    activeTextEditor: {},
                    createStatusBarItem: () => item,
                },
            };
        }
        if (request === '../config') {
            return {
                default: {
                    get: () => config,
                    getKey: () => undefined,
                },
            };
        }
        if (request === '../utils') {
            return {
                default: {
                    editor: { isSupported: () => true },
                    statistics: {
                        condition: { is: () => true },
                        template: { render: (template) => template },
                        tokens: { global: {} },
                    },
                },
            };
        }

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[statisticsPath];
        const statistics = require('../src/statusbars/statistics').default;

        return { item, statistics };
    } finally {
        NodeModule._load = originalLoad;
        if (previousStatistics) {
            require.cache[statisticsPath] = previousStatistics;
        } else {
            delete require.cache[statisticsPath];
        }
    }
};

describe('Statistics status bar', () => {
    it('clears text and tooltip when their templates render empty', function () {
        this.timeout(10000);

        const config = {
                statistics: {
                    statusbar: {
                        color: '',
                        command: '',
                        enabled: true,
                        text: 'Pending tasks',
                        tooltip: 'Task details',
                    },
                },
            },
            { item, statistics } = loadStatistics(config);

        expect(item.text).to.equal('Pending tasks');
        expect(item.tooltip).to.equal('Task details');

        config.statistics.statusbar.text = '';
        config.statistics.statusbar.tooltip = '';
        statistics.update();

        expect(item.text).to.equal('');
        expect(item.tooltip).to.equal('');
    });
});
