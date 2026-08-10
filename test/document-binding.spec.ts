import { expect } from 'chai';

const makeTextDocument = (text: string) => ({
    getText: () => text,
    lineAt: (lineNumber: number) => ({
        lineNumber,
        text,
        range: {
            start: { line: lineNumber, character: 0 },
            end: { line: lineNumber, character: text.length },
        },
    }),
});

const loadDocument = (visibleTextEditors, activeTextEditor) => {
    const NodeModule = require('module'),
        originalLoad = NodeModule._load,
        documentPath = require.resolve('../src/todo/document'),
        previousDocument = require.cache[documentPath],
        vscode = {
            window: {
                activeTextEditor,
                visibleTextEditors,
            },
        };

    class Item {
        textEditor;
        textDocument;
        line;
        match;

        constructor(textEditor, line?, match?) {
            this.textEditor = textEditor || null;
            this.textDocument = this.textEditor ? this.textEditor.document : null;
            this.line = line;
            this.match = match;
        }

        static is() {
            return true;
        }
    }

    const itemTypes = {
        Line: Item,
        Archive: Item,
        Comment: Item,
        Formatted: Item,
        Project: Item,
        Tag: Item,
        Todo: Item,
        TodoBox: Item,
        TodoFinished: Item,
        TodoDone: Item,
        TodoCancelled: Item,
    };

    NodeModule._load = (request: string, parent, isMain: boolean) => {
        if (request === 'vscode') return vscode;
        if (request === '../consts' && parent.filename === documentPath) {
            return { default: { regexes: { project: /Project:/g } } };
        }
        if (request === '../utils' && parent.filename === documentPath) {
            return { default: { editor: { isSupported: () => true } } };
        }
        if (request === './items' && parent.filename === documentPath) return itemTypes;

        return originalLoad(request, parent, isMain);
    };

    try {
        delete require.cache[documentPath];
        return require(documentPath).default;
    } finally {
        NodeModule._load = originalLoad;
        if (previousDocument) {
            require.cache[documentPath] = previousDocument;
        } else {
            delete require.cache[documentPath];
        }
    }
};

describe('Document item binding', () => {
    it('binds items to a background document instead of the active editor', () => {
        const targetDocument = makeTextDocument('Project:'),
            unrelatedDocument = makeTextDocument('const unrelated = true;'),
            unrelatedEditor = { document: unrelatedDocument },
            Document = loadDocument([], unrelatedEditor),
            document = new Document(targetDocument),
            project = document.getProjects()[0],
            projectAtLine = document.getProjectAt(0);

        expect(document.textEditor).to.equal(undefined);
        expect(project.textEditor).to.equal(null);
        expect(project.textDocument).to.equal(targetDocument);
        expect(project.textDocument.lineAt(0).text).to.equal('Project:');
        expect(projectAtLine.textDocument).to.equal(targetDocument);
        expect(projectAtLine.line.text).to.equal('Project:');
    });

    it('retains the editor that displays the requested document', () => {
        const targetDocument = makeTextDocument('Project:'),
            targetEditor = { document: targetDocument },
            unrelatedEditor = { document: makeTextDocument('const unrelated = true;') },
            Document = loadDocument([targetEditor], unrelatedEditor),
            document = new Document(targetDocument),
            project = document.getProjects()[0];

        expect(document.textEditor).to.equal(targetEditor);
        expect(project.textEditor).to.equal(targetEditor);
        expect(project.textDocument).to.equal(targetDocument);
    });
});
