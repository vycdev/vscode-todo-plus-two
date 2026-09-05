import { expect } from 'chai';

const loadTodoDone = () => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        decoratorPath = require.resolve('../src/todo/decorators/todo_done'),
        previousDecorator = require.cache[decoratorPath],
        createdDecorations: any[] = [];

    let strikethrough: boolean | undefined,
        colorsEnabled = true;

    class Line {
        getItemsRanges(items: any[]) {
            return [items.map((item) => item.range)];
        }
    }

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') {
            return {
                DecorationRangeBehavior: { ClosedOpen: 'closed-open' },
                window: {
                    createTextEditorDecorationType: (options) => {
                        const decoration = { options, dispose: () => undefined };

                        createdDecorations.push(decoration);

                        return decoration;
                    },
                },
            };
        }
        if (request === '../../config') {
            return {
                default: {
                    getKey: (key: string) =>
                        key === 'colors.enabled' ? colorsEnabled : strikethrough,
                },
            };
        }
        if (request === '../../consts') {
            return {
                default: {
                    colors: {
                        done: 'done',
                        dark: { done: 'dark-done' },
                        light: { done: 'light-done' },
                    },
                    regexes: { tag: /@\w+/, formattedCode: /`[^`]+`/ },
                },
            };
        }
        if (request === '../items/todo_done') {
            return { default: class TodoDoneItem {} };
        }
        if (request === './line') {
            return { default: Line };
        }

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[decoratorPath];

        return {
            TodoDone: require('../src/todo/decorators/todo_done').default,
            createdDecorations,
            setStrikethrough: (value: boolean | undefined) => {
                strikethrough = value;
            },
            setColorsEnabled: (value: boolean) => {
                colorsEnabled = value;
            },
        };
    } finally {
        NodeModule._load = originalLoad;
        if (previousDecorator) {
            require.cache[decoratorPath] = previousDecorator;
        } else {
            delete require.cache[decoratorPath];
        }
    }
};

describe('Done todo strikethrough decoration', () => {
    it('creates a line-through decoration and uses it by default', () => {
        const { TodoDone, createdDecorations } = loadTodoDone(),
            range = { name: 'done todo range' },
            decorations = new TodoDone().getDecorations([{ range }], []);

        expect(createdDecorations).to.have.length(2);
        expect(createdDecorations[1].options.textDecoration).to.equal('line-through');
        expect(decorations[0].ranges).to.deep.equal([]);
        expect(decorations[1].ranges).to.deep.equal([range]);
    });

    it('uses the normal done decoration when strikethrough is disabled', () => {
        const { TodoDone, setStrikethrough } = loadTodoDone(),
            range = { name: 'done todo range' };

        setStrikethrough(false);

        const decorations = new TodoDone().getDecorations([{ range }], []);

        expect(decorations[0].ranges).to.deep.equal([range]);
        expect(decorations[1].ranges).to.deep.equal([]);
    });

    it('keeps strikethrough without overriding syntax theme colors', () => {
        const { TodoDone, createdDecorations, setColorsEnabled } = loadTodoDone();

        setColorsEnabled(false);
        new TodoDone();

        expect(createdDecorations).to.have.length(2);
        expect(createdDecorations[0].options).not.to.have.property('color');
        expect(createdDecorations[1].options).not.to.have.property('color');
        expect(createdDecorations[1].options.textDecoration).to.equal('line-through');
    });
});
