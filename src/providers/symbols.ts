/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Consts from '../consts';
import Utils from '../utils';
import Document from '../todo/document';
import { getCodeBlocks } from '../utils/code-blocks';

/* SYMBOLS */

class Symbols implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(textDocument: vscode.TextDocument) {
    const doc = new Document(textDocument),
      projects = doc.getProjects(),
      projectsDatas = [],
      symbols = [];

    const code = getCodeBlocks(textDocument);
    projects.forEach((project) => {
      /* SYMBOL */

      const parts = project.line.text.match(Consts.regexes.projectParts),
        level = Utils.ast.getLevel(textDocument, parts[1]),
        name = _.trim(parts[2]),
        selectionRange = project.range,
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
