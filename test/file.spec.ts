import { expect } from 'chai';

const loadFile = (vscode) => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        filePath = require.resolve('../src/utils/file'),
        previousFile = require.cache[filePath];

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') return vscode;

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[filePath];
        return require('../src/utils/file').default;
    } finally {
        NodeModule._load = originalLoad;
        if (previousFile) {
            require.cache[filePath] = previousFile;
        } else {
            delete require.cache[filePath];
        }
    }
};

describe('File', () => {
    it('centers the selected range when opening a text document', async () => {
        const document = {},
            editor = {
                selection: undefined,
                revealRange: (range, revealType) => {
                    revealedRange = range;
                    usedRevealType = revealType;
                },
            },
            vscode = {
                Position: class {
                    constructor(
                        public line: number,
                        public character: number
                    ) {}
                },
                Selection: class {
                    constructor(
                        public start,
                        public end
                    ) {}
                },
                TextEditorRevealType: { InCenter: 'center' },
                Uri: { file: (filepath) => filepath },
                workspace: {
                    openTextDocument: () => Promise.resolve(document),
                },
                window: {
                    activeTextEditor: editor,
                    showTextDocument: () => Promise.resolve(editor),
                },
            },
            File = loadFile(vscode);
        let revealedRange, usedRevealType;

        await File.open('/workspace/tasks.todo', true, 12, 3, 8);

        expect(editor.selection.start).to.deep.include({ line: 12, character: 3 });
        expect(editor.selection.end).to.deep.include({ line: 12, character: 8 });
        expect(revealedRange).to.equal(editor.selection);
        expect(usedRevealType).to.equal(vscode.TextEditorRevealType.InCenter);
    });
});
