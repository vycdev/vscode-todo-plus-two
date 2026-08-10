import { expect } from 'chai';

const loadItem = () => {
    const NodeModule = require('module');
    const originalLoad = NodeModule._load;
    const itemPath = require.resolve('../src/todo/items/item');
    const previousItem = require.cache[itemPath];

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') return {};
        if (request === '../../utils') {
            return {
                default: {
                    regex: {
                        match2range: (match) => ({
                            start: match.index || 0,
                            end: (match.index || 0) + match[0].length,
                        }),
                    },
                },
            };
        }

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[itemPath];
        return require('../src/todo/items/item').default;
    } finally {
        NodeModule._load = originalLoad;
        if (previousItem) {
            require.cache[itemPath] = previousItem;
        } else {
            delete require.cache[itemPath];
        }
    }
};

describe('Text-only todo items', () => {
    it('does not access document APIs when reading position or range', () => {
        const Item = loadItem();
        const match = Object.assign(['☐ detached task'], { index: 0 });
        const item = new Item(null, undefined, match);

        expect(item.lineNumber).to.equal(-1);
        expect(item.range).to.equal(null);
    });
});
