interface TextDocumentLike {
    getText(): string;
}

interface ParsedDocumentLike {
    textDocument: TextDocumentLike;
}

export class DocumentLinesCache {
    private readonly lines = new WeakMap<TextDocumentLike, string[]>();

    get(textDocument: TextDocumentLike): string[];
    get(textDocument: TextDocumentLike, lineNr: number): string;
    get(textDocument: TextDocumentLike, lineNr?: number) {
        const lines = this.lines.get(textDocument);

        return lines && typeof lineNr === 'number' ? lines[lineNr] : lines;
    }

    update(textDocument: TextDocumentLike) {
        this.lines.set(textDocument, textDocument.getText().split('\n'));
    }

    didChange(doc: ParsedDocumentLike) {
        const prevLines = this.get(doc.textDocument);

        if (prevLines && prevLines.join('\n') === doc.textDocument.getText()) return false;

        return true;
    }
}
