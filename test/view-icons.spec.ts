import { expect } from 'chai';
import * as path from 'path';

const withView = (colors, run) => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        viewPath = require.resolve('../src/utils/view'),
        previousView = require.cache[viewPath],
        writtenPaths: string[] = [];

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') {
            return { Uri: { file: (filePath) => filePath } };
        }
        if (request === '../consts') {
            return { default: { colors } };
        }
        if (request === '.') {
            return { default: { context: { storagePath: '/storage' } } };
        }
        if (request === 'fs') {
            return {
                existsSync: () => false,
                writeFileSync: (filePath) => writtenPaths.push(filePath),
            };
        }
        if (request === 'mkdirp') {
            return { sync: () => undefined };
        }
        if (request === 'sha1') {
            return (value) => `hash-${value}`;
        }

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[viewPath];
        const view = require('../src/utils/view').default;

        return run(view, writtenPaths);
    } finally {
        NodeModule._load = originalLoad;
        if (previousView) {
            require.cache[viewPath] = previousView;
        } else {
            delete require.cache[viewPath];
        }
    }
};

describe('View type icons', () => {
    it('refreshes a cached type icon after its configured color changes', () => {
        const colors = { types: { TODO: '#ff0000' } };

        withView(colors, (view, writtenPaths) => {
            const firstIcon = view.getTypeIcon('TODO');

            colors.types.TODO = '#0000ff';

            const secondIcon = view.getTypeIcon('TODO');

            expect(secondIcon).not.to.equal(firstIcon);
            expect(writtenPaths).to.deep.equal([
                path.join('/storage', 'type-color-hash-#ff0000.svg'),
                path.join('/storage', 'type-color-hash-#0000ff.svg'),
            ]);
        });
    });
});
