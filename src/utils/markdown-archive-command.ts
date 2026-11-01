import * as path from 'path';
import * as moment from 'moment';
import { Range, TextEdit } from 'vscode';
import type { TextEditor } from 'vscode';
import Config from '../config';
import Folder from './folder';
import Editor from './editor';
import Tags from './tags';
import { findMarkdownTaskTag, transformMarkdownTaskText } from './markdown-task-text';
import { archiveToFile } from './archive-storage';
import { getMarkdownTaskOptions, getMarkdownTaskNodes } from './task-source';
import {
  collectMarkdownArchiveBlocks,
  insertMarkdownArchiveBlocks,
  removeMarkdownArchiveBlocks,
} from './markdown-archive';

export const archiveMarkdownTasks = async (
  editor: TextEditor,
  selectedLines?: number[]
): Promise<number> => {
  const document = editor.document;
  const content = document.getText();
  const options = getMarkdownTaskOptions();
  const restoring = !!selectedLines;
  const blocks = collectMarkdownArchiveBlocks(content, options, selectedLines, restoring);
  if (!blocks.length) return 0;
  const source = removeMarkdownArchiveBlocks(content, blocks);
  if (!restoring) {
    const taskLines = new Set(
      getMarkdownTaskNodes(document)
        .filter((node) => node.kind === 'todo')
        .map((node) => node.lineNumber)
    );
    blocks.forEach((block) => {
      block.lines = block.lines.map((line, index) =>
        taskLines.has(block.start + index)
          ? transformMarkdownTaskText(line, (text) =>
              Tags.remove(text, Config.getKey('archive.remove.tags') || [])
            )
          : line
      );
    });
    if (Config.getKey('archive.sortByDate')) {
      const date = (block) => {
        const pattern = /@(?:done|cancelled)\(([^)]*)\)/;
        const tag = findMarkdownTaskTag(block.lines[0], pattern);
        const match = tag && tag.text.match(pattern);
        return match ? moment(match[1], Config.getKey('timekeeping.finished.format')).valueOf() : 0;
      };
      blocks.sort((left, right) => date(right) - date(left));
    }
  }
  const fullRange = new Range(document.positionAt(0), document.positionAt(content.length));
  const type = Config.getKey('archive.type');
  if (restoring || type === 'InSameFile') {
    const merged = insertMarkdownArchiveBlocks(
      source,
      blocks,
      options,
      !restoring,
      content.includes('\r\n') ? '\r\n' : '\n'
    );
    if (!(await Editor.edits.apply(editor, [TextEdit.replace(fullRange, merged)])))
      throw new Error('Unable to apply the Markdown archive edits');
  } else {
    const sourcePath = document.uri.fsPath;
    const destination =
      type === 'InSeparateFile'
        ? path.join(
            Folder.getRootPath(sourcePath) || path.dirname(sourcePath),
            `ARCHIVE.${path.basename(Config.getKey('file.name') || 'TODO', path.extname(Config.getKey('file.name') || 'TODO'))}.md`
          )
        : path.join(
            path.dirname(sourcePath),
            `ARCHIVE.${path.basename(sourcePath).replace(/^\./, '')}`
          );
    await archiveToFile(destination, document, [TextEdit.replace(fullRange, source)], (existing) =>
      insertMarkdownArchiveBlocks(
        existing,
        blocks,
        options,
        true,
        content.includes('\r\n') ? '\r\n' : '\n'
      )
    );
  }
  return blocks.length;
};
