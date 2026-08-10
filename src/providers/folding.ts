/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../consts';
import { getFoldingRanges } from '../utils/folding';

/* FOLDING */

class Folding implements vscode.FoldingRangeProvider {
    provideFoldingRanges(textDocument: vscode.TextDocument) {
        const lines = Array.from(
                { length: textDocument.lineCount },
                (_, lineNumber) => textDocument.lineAt(lineNumber).text
            ),
            projectRegex = new RegExp(
                Consts.regexes.project.source,
                Consts.regexes.project.flags.replace('g', '')
            ),
            configuredTabSize = vscode.workspace
                .getConfiguration('editor', textDocument.uri)
                .get('tabSize'),
            tabSize = typeof configuredTabSize === 'number' ? configuredTabSize : 4;

        return getFoldingRanges(lines, (line) => projectRegex.test(line), tabSize).map(
            ({ start, end }) => new vscode.FoldingRange(start, end)
        );
    }
}

/* EXPORT */

export default Folding;
