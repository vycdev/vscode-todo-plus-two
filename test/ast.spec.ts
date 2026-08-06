import { expect } from 'chai';

const loadAst = () => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        astPath = require.resolve('../src/utils/ast'),
        previousAst = require.cache[astPath];

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') {
            return {
                window: {
                    activeTextEditor: undefined,
                    visibleTextEditors: [],
                },
            };
        }
        if (request === '../consts') {
            return { default: { regexes: { empty: /^\s*$/ } } };
        }
        if (request === './editor') {
            return { default: { getIndentation: () => undefined } };
        }

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[astPath];
        return require('../src/utils/ast').default;
    } finally {
        NodeModule._load = originalLoad;
        if (previousAst) {
            require.cache[astPath] = previousAst;
        } else {
            delete require.cache[astPath];
        }
    }
};

describe('AST indentation detection', () => {
    it('refreshes the cached indentation after a document edit', () => {
        const AST = loadAst();
        let text = 'Project:\n    ☐ child';
        const document = {
            fileName: '/workspace/reindented.todo',
            getText: () => text,
            lineCount: 2,
            version: 1,
        };

        expect(AST.getLevel(document, '    ☐ child')).to.equal(1);

        text = 'Project:\n  ☐ child';
        document.version++;

        expect(AST.getLevel(document, '  ☐ child')).to.equal(1);
    });

    it('keeps cache entries separate for reopened documents', () => {
        const AST = loadAst(),
            firstDocument = {
                fileName: '/workspace/reopened.todo',
                getText: () => 'Project:\n    ☐ child',
                lineCount: 2,
                version: 1,
            },
            reopenedDocument = {
                fileName: '/workspace/reopened.todo',
                getText: () => 'Project:\n  ☐ child',
                lineCount: 2,
                version: 1,
            };

        expect(AST.getLevel(firstDocument, '    ☐ child')).to.equal(1);
        expect(AST.getLevel(reopenedDocument, '  ☐ child')).to.equal(1);
    });
});
