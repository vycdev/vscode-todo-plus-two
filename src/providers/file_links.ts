/* IMPORT */

import * as vscode from 'vscode';
import { findRelativeFileLinks } from '../utils/file-links';

/* FILE LINKS */

export class FileLinkProvider implements vscode.DocumentLinkProvider {
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        if (document.uri.scheme !== 'file') return [];

        const links: vscode.DocumentLink[] = [];

        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            findRelativeFileLinks(document.lineAt(lineNumber).text, document.uri.fsPath).forEach(
                (link) => {
                    const range = new vscode.Range(
                        new vscode.Position(lineNumber, link.start),
                        new vscode.Position(lineNumber, link.end)
                    );

                    links.push(new vscode.DocumentLink(range, vscode.Uri.file(link.targetPath)));
                }
            );
        }

        return links;
    }
}
