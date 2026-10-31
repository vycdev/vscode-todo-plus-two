import { MarkdownTaskNode, MarkdownTaskOptions, parseMarkdownTasks } from './markdown-tasks';
import { splitLines } from './line-splitting';

export interface MarkdownArchiveBlock {
  start: number;
  end: number;
  path: string[];
  lines: string[];
}

const samePath = (left: string[], right: string[]) =>
  left.length === right.length && left.every((title, index) => title === right[index]);

const pathOf = (node: MarkdownTaskNode, nodes: MarkdownTaskNode[]): string[] => {
  const path = [];
  let parent = nodes.find((candidate) => candidate.lineNumber === node.parent);
  while (parent && !parent.archiveRoot) {
    path.unshift(parent.title);
    parent = nodes.find((candidate) => candidate.lineNumber === parent.parent);
  }
  return path;
};

const reindent = (lines: string[], prefix: string): string[] => {
  const original = (lines[0].match(/^[ \t]*/) || [''])[0];
  return lines.map((line) =>
    !line.trim()
      ? line
      : prefix + (line.startsWith(original) ? line.slice(original.length) : line.trimLeft())
  );
};

const childPrefix = (node: MarkdownTaskNode, lines: string[]): string => {
  if (!node || node.heading) return '';
  const indentation = (lines[node.lineNumber].match(/^[ \t]*/) || [''])[0];
  return indentation + ' '.repeat(node.contentIndent ? node.contentIndent - node.indent : 2);
};

/** A finished parent moves only with its complete, finished task subtree. */
export const collectMarkdownArchiveBlocks = (
  content: string,
  options: MarkdownTaskOptions,
  selectedLines?: number[],
  fromArchive = false
): MarkdownArchiveBlock[] => {
  const lines = splitLines(content);
  const nodes = parseMarkdownTasks(content, options);
  const tasks = nodes.filter((node) => node.kind === 'todo');
  const eligible = tasks.filter(
    (task) =>
      task.inArchive === fromArchive &&
      task.status !== 'box' &&
      (!selectedLines || selectedLines.includes(task.lineNumber)) &&
      !tasks.some(
        (child) =>
          child.lineNumber > task.lineNumber &&
          child.lineNumber < task.endLine &&
          child.status === 'box'
      )
  );
  return eligible
    .filter(
      (task) =>
        !eligible.some(
          (parent) =>
            parent !== task &&
            parent.lineNumber < task.lineNumber &&
            task.lineNumber < parent.endLine
        )
    )
    .map((task) => ({
      start: task.lineNumber,
      end: task.endLine,
      path: pathOf(task, nodes),
      lines: lines.slice(task.lineNumber, task.endLine),
    }));
};

export const removeMarkdownArchiveBlocks = (
  content: string,
  blocks: MarkdownArchiveBlock[]
): string => {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return splitLines(content)
    .filter((_line, index) => !blocks.some((block) => index >= block.start && index < block.end))
    .join(eol);
};

/** Merge by structural path, retaining existing headings, notes and task spelling. */
export const insertMarkdownArchiveBlocks = (
  content: string,
  blocks: MarkdownArchiveBlock[],
  options: MarkdownTaskOptions,
  intoArchive = true,
  sourceEol = '\n'
): string => {
  if (!blocks.length) return content;
  const eol = content.includes('\r\n') ? '\r\n' : content ? '\n' : sourceEol;
  let lines = content ? splitLines(content) : [];
  const parse = () =>
    parseMarkdownTasks(lines.join(eol), { ...options, scope: 'all', includeEmptyProjects: true });
  if (intoArchive && !parse().some((node) => node.archiveRoot)) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    lines.push(`# ${options.archiveName || 'Archive'}`, '');
  }
  blocks.forEach((block) => {
    let nodes = parse();
    let target = intoArchive ? nodes.find((node) => node.archiveRoot) : undefined;
    const archive = nodes.find((node) => node.archiveRoot);
    for (let depth = 0; depth < block.path.length; depth++) {
      const names = block.path.slice(0, depth + 1);
      const found = nodes.find(
        (node) =>
          !node.archiveRoot &&
          node.inArchive === intoArchive &&
          samePath(pathOf(node, nodes).concat(node.title), names)
      );
      if (found) {
        target = found;
        continue;
      }
      let insertAt = target
        ? target.endLine
        : intoArchive
          ? lines.length
          : archive
            ? archive.lineNumber
            : lines.length;
      while (insertAt > 0 && !lines[insertAt - 1].trim()) insertAt--;
      const prefix = childPrefix(target, lines);
      lines.splice(insertAt, 0, `${prefix}${block.path[depth]}:`);
      nodes = parse();
      target = nodes.find((node) => node.lineNumber === insertAt);
    }
    let insertAt = target
      ? target.endLine
      : archive && !intoArchive
        ? archive.lineNumber
        : lines.length;
    while (insertAt > 0 && !lines[insertAt - 1].trim()) insertAt--;
    const prefix = childPrefix(target, lines);
    lines.splice(insertAt, 0, ...reindent(block.lines, prefix));
  });
  return lines.join(eol);
};
