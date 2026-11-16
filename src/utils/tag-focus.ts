import { getIndentationWidth } from './folding';
import type { FoldingLineRange } from './folding';
import { maskInlineCode } from './todo-status';

export const TAG_FOCUS_HEADER = '(folded)';

export const isTagFocusHeader = (line: string): boolean =>
  line.trim() === TAG_FOCUS_HEADER || line.trim() === '@region';

const getLineTagNames = (text: string, tagPattern: RegExp): string[] => {
  const regex = new RegExp(tagPattern.source, 'g');
  const masked = maskInlineCode(text, true);
  const tags: string[] = [];
  let match: RegExpExecArray;

  while ((match = regex.exec(masked))) {
    const name = match[1].replace(/\([^)]*\)$/, '').replace(/[.,;:!?()[\]{}<>"']+$/, '');

    if (name.length > 1) tags.push(name);
  }

  return tags;
};

export const getFocusTagNames = (
  lines: string[],
  isTodo: (line: string) => boolean,
  tagPattern: RegExp
): string[] => {
  const names = new Map<string, string>();

  lines.filter(isTodo).forEach((line) => {
    getLineTagNames(line, tagPattern).forEach((name) => {
      if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    });
  });

  return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
};

export const getTagFocusRanges = (
  lines: string[],
  tag: string,
  isTodo: (line: string) => boolean,
  isProject: (line: string) => boolean,
  tagPattern: RegExp,
  tabSize = 4
): FoldingLineRange[] => {
  const visible = new Set([0]);
  const ancestors: { line: number; indentation: number }[] = [];

  lines.forEach((line, lineNumber) => {
    if (!line.trim()) return;

    const indentation = getIndentationWidth(line, tabSize);
    while (ancestors.length && ancestors[ancestors.length - 1].indentation >= indentation) {
      ancestors.pop();
    }

    const todo = isTodo(line);
    if (
      todo &&
      getLineTagNames(line, tagPattern).some((name) => name.toLowerCase() === tag.toLowerCase())
    ) {
      visible.add(lineNumber);
      ancestors.forEach((ancestor) => visible.add(ancestor.line));
    }

    if (todo || isProject(line)) ancestors.push({ line: lineNumber, indentation });
  });

  const ranges: FoldingLineRange[] = [];
  for (let line = 1; line < lines.length; line++) {
    if (visible.has(line)) continue;

    const start = line - 1;
    while (line + 1 < lines.length && !visible.has(line + 1)) line++;
    ranges.push({ start, end: line });
  }

  return ranges;
};
