/* IMPORT */

import { FoldingRange, FoldingRangeKind, window } from 'vscode';
import type { FoldingRangeProvider, TextDocument } from 'vscode';
import Consts from '../consts';
import { getFoldingRanges } from '../utils/folding';
import { getCodeBlocks } from '../utils/code-blocks';
import { getEditorSetting } from '../utils/editor-configuration';
import { getTagFocusRanges, isTagFocusHeader } from '../utils/tag-focus';

/* FOLDING */

export class FoldingProvider implements FoldingRangeProvider {
  constructor(
    private getFocusTag: (document: TextDocument) => string | undefined = () => undefined
  ) {}

  provideFoldingRanges(textDocument: TextDocument): FoldingRange[] {
    const lines = Array.from(
        { length: textDocument.lineCount },
        (_, lineNumber) => textDocument.lineAt(lineNumber).text
      ),
      projectRegex = new RegExp(
        Consts.regexes.project.source,
        Consts.regexes.project.flags.replace('g', '')
      ),
      editorTabSize = window.visibleTextEditors.find((editor) => editor.document === textDocument)
        ?.options.tabSize,
      configuredTabSize =
        typeof editorTabSize === 'number'
          ? editorTabSize
          : getEditorSetting<number | string>(textDocument, 'tabSize'),
      tabSize = typeof configuredTabSize === 'number' ? configuredTabSize : 4;

    const code = getCodeBlocks(textDocument);
    const structuralLines = lines.map((line, index) => {
      const block = code.byLine.get(index);
      return block ? lines[block.startLine].match(/^[\t ]*/)[0] + 'code' : line;
    });
    const tag = this.getFocusTag(textDocument);
    const todoRegex = new RegExp(
      Consts.regexes.todo.source,
      Consts.regexes.todo.flags.replace('g', '')
    );
    const ranges =
      tag && isTagFocusHeader(lines[0])
        ? getTagFocusRanges(
            structuralLines,
            tag,
            (line) => todoRegex.test(line),
            (line) => projectRegex.test(line),
            Consts.regexes.tag,
            tabSize
          )
        : getFoldingRanges(structuralLines, (line) => projectRegex.test(line), tabSize);

    if (!tag || !isTagFocusHeader(lines[0])) {
      code.blocks.forEach((block) => {
        const end = block.closed ? block.endLine - 1 : block.endLine;
        if (end > block.startLine) ranges.push({ start: block.startLine, end });
      });
      ranges.sort((left, right) => left.start - right.start);
    }

    return ranges.map(
      ({ start, end, kind }) =>
        new FoldingRange(start, end, kind === 'region' ? FoldingRangeKind.Region : undefined)
    );
  }
}
