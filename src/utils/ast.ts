/* IMPORT */

import * as detectIndent from 'detect-indent';
import * as vscode from 'vscode';
import Consts from '../consts';
import Editor from './editor';

/* AST */

const AST = {
    indentationRe: /^( +|\t+)/m,

    indentations: {}, // filePath => { indentation, lineCount, confident }

    getIndentation(textDocument: vscode.TextDocument) {
        const filePath = textDocument.fileName,
            cached = AST.indentations[filePath];

        if (cached) {
            if (cached.confident) return cached.indentation; // We are confident about this

            if (cached.lineCount === textDocument.lineCount) return cached.indentation; // Probably nothing changed
        }

        const text = textDocument.getText(),
            match = AST.indentationRe.exec(text),
            endIndex = Math.min(text.length, match ? match.index + 300 : 500), // We don't want to process huge documents
            sample = text.slice(0, endIndex);

        // Prefer an editor's indentation settings for this document
        const editor =
            vscode.window.visibleTextEditors.find((te) => te.document === textDocument) ||
            (vscode.window.activeTextEditor &&
            vscode.window.activeTextEditor.document === textDocument
                ? vscode.window.activeTextEditor
                : undefined);

        let indentation: string | undefined;
        if (editor) {
            indentation = Editor.getIndentation(editor, undefined as any);
        }

        // If the editor didn't provide a consistent indentation, fall back on detection
        if (!indentation) indentation = detectIndent(sample).indent || '    ';

        AST.indentations[filePath] = {
            indentation,
            lineCount: textDocument.lineCount,
            confident: !!match,
        };

        return indentation;
    },

    getLevel(textDocument: vscode.TextDocument, str) {
        const indentation = AST.getIndentation(textDocument);

        let level = 0,
            index = 0;

        while (index < str.length) {
            if (str.substr(index, indentation.length) !== indentation) break;
            level++;
            index += indentation.length;
        }

        return level;
    },

    /* WALK */

    walk(
        textDocument: vscode.TextDocument,
        lineNr: number = 0,
        direction: number = 1,
        skipEmptyLines: boolean = true,
        strictlyMonotonic: boolean = false,
        callback: Function
    ) {
        // strictlyMonotonic: only go strictly up or down, don't process other elements at the same level

        const { lineCount } = textDocument;

        const startLine = lineNr >= 0 ? textDocument.lineAt(lineNr) : null,
            startLevel = startLine ? AST.getLevel(textDocument, startLine.text) : -1;

        let prevLevel = startLevel,
            nextLine = lineNr + direction;

        while (nextLine >= 0 && nextLine < lineCount) {
            const line = textDocument.lineAt(nextLine);

            if (skipEmptyLines && (!line.text || Consts.regexes.empty.test(line.text))) {
                nextLine += direction;
                continue;
            }

            const level = AST.getLevel(textDocument, line.text);

            if (direction > 0 && level < startLevel) break;

            if (
                strictlyMonotonic &&
                ((direction > 0 && level <= prevLevel) || (direction < 0 && level >= prevLevel))
            ) {
                nextLine += direction;
                continue;
            }

            if (callback({ startLine, startLevel, line, level }) === false) break;

            prevLevel = level;
            nextLine += direction;
        }
    },

    walkDown(
        textDocument: vscode.TextDocument,
        lineNr: number,
        skipEmptyLines: boolean,
        strictlyMonotonic: boolean,
        callback: Function
    ) {
        return AST.walk(textDocument, lineNr, 1, skipEmptyLines, strictlyMonotonic, callback);
    },

    walkUp(
        textDocument: vscode.TextDocument,
        lineNr: number,
        skipEmptyLines: boolean,
        strictlyMonotonic: boolean,
        callback: Function
    ) {
        return AST.walk(textDocument, lineNr, -1, skipEmptyLines, strictlyMonotonic, callback);
    },

    walkChildren(textDocument: vscode.TextDocument, lineNr: number, callback: Function) {
        return AST.walkDown(
            textDocument,
            lineNr,
            true,
            false,
            function ({ startLine, startLevel, line, level }) {
                if (level <= startLevel) return false;

                if (level > startLevel + 1) return;

                callback.apply(undefined, arguments);
            }
        );
    },
};

/* EXPORT */

export default AST;
