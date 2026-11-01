/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../consts';
import { getFoldingRanges } from '../utils/folding';
import { getCodeBlocks } from '../utils/code-blocks';

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

    const code = getCodeBlocks(textDocument);
    const structuralLines = lines.map((line, index) => {
      const block = code.byLine.get(index);
      return block ? lines[block.startLine].match(/^[\t ]*/)[0] + 'code' : line;
    });
    const ranges = getFoldingRanges(structuralLines, (line) => projectRegex.test(line), tabSize);
    code.blocks.forEach((block) => {
      const end = block.closed ? block.endLine - 1 : block.endLine;
      if (end > block.startLine) ranges.push({ start: block.startLine, end });
    });
    return ranges
      .sort((left, right) => left.start - right.start)
      .map(({ start, end }) => new vscode.FoldingRange(start, end));
  }
}

/* EXPORT */

export default Folding;
