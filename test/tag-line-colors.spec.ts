import { expect } from 'chai';

const loadTagDecorator = () => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        tagPath = require.resolve('../src/todo/decorators/tag'),
        previousTag = require.cache[tagPath],
        options = [];

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') {
            return {
                DecorationRangeBehavior: { ClosedClosed: 'closed' },
                window: {
                    createTextEditorDecorationType: (decorationOptions) => {
                        options.push(decorationOptions);
                        return { options: decorationOptions, dispose: () => undefined };
                    },
                },
            };
        }
        if (request === '../../consts') {
            const tagColors = {
                tag: '#tag',
                id: '#id',
                dependency: '#dependency',
                tags: {
                    background: [],
                    foreground: [],
                    lineBackground: ['#critical', '#today'],
                },
            };

            return {
                default: {
                    tags: { names: ['critical', 'today', 'home'] },
                    colors: {
                        ...tagColors,
                        dark: {
                            ...tagColors,
                            tags: {
                                ...tagColors.tags,
                                lineBackground: ['#dark-critical', '#dark-today'],
                            },
                        },
                        light: {
                            ...tagColors,
                            tags: {
                                ...tagColors.tags,
                                lineBackground: ['#light-critical', '#light-today'],
                            },
                        },
                    },
                },
            };
        }
        if (request === './line') {
            return {
                default: class Line {
                    TYPES = [];

                    getItemsRanges(items) {
                        const itemRanges = items.map((item) => (this as any).getItemRanges(item));

                        return itemRanges[0].map((_range, index) =>
                            itemRanges.map((ranges) => ranges[index]).filter(Boolean)
                        );
                    }
                },
            };
        }
        if (request === '../items/tag') return { default: class TagItem {} };

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[tagPath];
        return { Tag: require('../src/todo/decorators/tag').default, options };
    } finally {
        NodeModule._load = originalLoad;
        if (previousTag) {
            require.cache[tagPath] = previousTag;
        } else {
            delete require.cache[tagPath];
        }
    }
};

describe('Special tag line colors', () => {
    it('uses the first colored tag on a line for its whole-line background', () => {
        const { Tag, options } = loadTagDecorator(),
            decorator = new Tag(),
            todayRange = { start: 1, end: 2 },
            criticalRange = { start: 3, end: 4 },
            decorations = decorator.getDecorations([
                {
                    match: ['@today', undefined, '@today'],
                    range: todayRange,
                    lineNumber: 0,
                    isId: () => false,
                    isDependency: () => false,
                    isNormal: () => false,
                },
                {
                    match: ['@critical', '@critical', undefined],
                    range: criticalRange,
                    lineNumber: 0,
                    isId: () => false,
                    isDependency: () => false,
                    isNormal: () => false,
                },
            ]);

        expect(options[3]).to.deep.include({
            backgroundColor: '#critical',
            isWholeLine: true,
            dark: { backgroundColor: '#dark-critical' },
            light: { backgroundColor: '#light-critical' },
        });
        expect(options[4]).to.deep.include({
            backgroundColor: '#today',
            isWholeLine: true,
        });
        expect(options[5]).to.deep.include({
            backgroundColor: '#critical',
            isWholeLine: true,
            dark: { backgroundColor: '#dark-critical' },
            light: { backgroundColor: '#light-critical' },
        });
        expect(decorations[0].ranges).to.deep.equal([]);
        expect(decorations[1].ranges).to.deep.equal([todayRange]);
    });
});
