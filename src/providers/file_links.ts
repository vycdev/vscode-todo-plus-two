/* IMPORT */

import * as vscode from 'vscode';
import { findRelativeFileLinks } from '../utils/file-links';
import { getMarkdownTaskNodes, isMarkdownTaskDocument } from '../utils/task-source';
import { maskMarkdownTaskText } from '../utils/markdown-task-text';

/* FILE LINKS */

export class FileLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (document.uri.scheme !== 'file') return [];
    if (document.languageId === 'markdown' && !isMarkdownTaskDocument(document)) return [];
    const markdownTasks = isMarkdownTaskDocument(document)
      ? new Set(
          getMarkdownTaskNodes(document)
            .filter((node) => node.kind === 'todo')
            .map((node) => node.lineNumber)
        )
      : undefined;

    const links: vscode.DocumentLink[] = [];

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
      if (markdownTasks && !markdownTasks.has(lineNumber)) continue;
      const raw = document.lineAt(lineNumber).text;
      findRelativeFileLinks(
        markdownTasks ? maskMarkdownTaskText(raw) : raw,
        document.uri.fsPath
      ).forEach((link) => {
        const range = new vscode.Range(
          new vscode.Position(lineNumber, link.start),
          new vscode.Position(lineNumber, link.end)
        );

        links.push(new vscode.DocumentLink(range, vscode.Uri.file(link.targetPath)));
      });
    }

    return links;
  }
}
