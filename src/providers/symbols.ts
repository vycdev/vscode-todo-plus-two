/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Consts from '../consts';
import Utils from '../utils';
import Document from '../todo/document';
import { getCodeBlocks } from '../utils/code-blocks';
import { getTodoTaskTags } from '../utils/markdown-task-text';

/* SYMBOLS */

const getProjectName = (line: string, parsedHeading: string) => {
  const masked = line.split('');
  // Locate the heading delimiter without interpreting colons inside tag arguments.
  for (const tag of getTodoTaskTags(line)) {
    const argument = tag.text.indexOf('(');
    if (argument < 0) continue;
    for (let index = tag.start + argument + 1; index < tag.end - 1; index++) {
      if (masked[index] === ':') masked[index] = ' ';
    }
  }

  const heading = new RegExp(Consts.regexes.project.source).exec(masked.join('')),
    range = heading && Utils.regex.match2range(heading),
    text = range ? line.slice(range.start, range.end) : parsedHeading;

  return text.slice(0, -1).trim();
};

class Symbols implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(textDocument: vscode.TextDocument) {
    const doc = new Document(textDocument),
      projects = doc.getProjects(),
      projectsDatas = [],
      symbols = [];

    const code = getCodeBlocks(textDocument);
    projects.forEach((project) => {
      /* SYMBOL */

      const level = Utils.ast.getLevel(textDocument, project.line.text),
        selectionRange = project.range,
        name = getProjectName(project.line.text, project.text),
        startLine = selectionRange.start.line,
        startCharacter = selectionRange.start.character;

      let endLine = startLine;

      for (let lineNumber = startLine + 1; lineNumber < textDocument.lineCount; lineNumber++) {
        const block = code.byLine.get(lineNumber);
        const text = textDocument.lineAt(block ? block.startLine : lineNumber).text;
        if (!text.trim()) continue;
        if (Utils.ast.getLevel(textDocument, text) <= level) break;
        endLine = block ? block.endLine : lineNumber;
        if (block) lineNumber = block.endLine;
      }

      const endCharacter = doc.textDocument.lineAt(endLine).range.end.character,
        fullRange = new vscode.Range(startLine, startCharacter, endLine, endCharacter),
        symbol = new vscode.DocumentSymbol(
          name,
          undefined,
          vscode.SymbolKind.Field,
          fullRange,
          selectionRange
        );

      projectsDatas.push({ level, name, symbol });

      /* PARENT */

      const parentData =
          _.findLast(
            projectsDatas,
            (data) => data.level < level && data.symbol.range.end.line >= startLine
          ) || {},
        { symbol: parentSymbol } = parentData;

      if (parentSymbol) {
        parentSymbol.children.push(symbol);
      } else {
        symbols.push(symbol);
      }
    });

    return symbols;
  }
}

/* EXPORT */

export default Symbols;
