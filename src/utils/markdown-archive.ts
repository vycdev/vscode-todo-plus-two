import {
  MarkdownTaskNode,
  MarkdownTaskOptions,
  parseMarkdownTasks,
  quoteMarkdownProjectTitle,
} from './markdown-tasks';
import { transformMarkdownTaskText } from './markdown-task-text';
import { splitLines } from './line-splitting';
import Tags from './tags';

interface MarkdownArchiveOptions extends MarkdownTaskOptions {
  finishedRemoveTags?: string[];
}

export interface MarkdownArchiveBlock {
  start: number;
  end: number;
  path: string[];
  lines: string[];
  taskCount: number;
}

const samePath = (left: string[], right: string[]) =>
  left.length === right.length && left.every((title, index) => title === right[index]);

const pathTitle = (node: MarkdownTaskNode, options: MarkdownArchiveOptions): string => {
  if (node.markerStart === undefined) return node.title;
  // Completing or timing a parent must not change the path of an archived child.
  return transformMarkdownTaskText(node.title, (text) =>
    Tags.remove(text, [
      'created',
      'started',
      'toggle',
      'done',
      'cancelled',
      'lasted',
      'wasted',
      ...(options.finishedRemoveTags || ['today']),
    ])
  );
};

const pathOf = (
  node: MarkdownTaskNode,
  nodes: MarkdownTaskNode[],
  options: MarkdownArchiveOptions
): string[] => {
  const path = [];
  let parent = nodes.find((candidate) => candidate.lineNumber === node.parent);
  while (parent && !parent.archiveRoot) {
    path.unshift(pathTitle(parent, options));
    parent = nodes.find((candidate) => candidate.lineNumber === parent.parent);
  }
  return path;
};

const reindent = (lines: string[], prefix: string): string[] => {
  const original = (lines[0].match(/^[ \t]*/) || [''])[0];
  const width = (whitespace: string) => whitespace.replace(/\t/g, '    ').length;
  return lines.map((line) =>
    !line.trim()
      ? line
      : line.startsWith(original)
        ? prefix + line.slice(original.length)
        : ' '.repeat(
            Math.max(0, width(prefix) + width((line.match(/^[ \t]*/) || [''])[0]) - width(original))
          ) + line.trimLeft()
  );
};

const childPrefix = (node: MarkdownTaskNode, lines: string[]): string => {
  if (!node) return '';
  const indentation = (lines[node.lineNumber].match(/^[ \t]*/) || [''])[0];
  if (node.heading) return indentation;
  return indentation + ' '.repeat(node.contentIndent ? node.contentIndent - node.indent : 2);
};

/** A finished parent moves only with its complete, finished task subtree. */
export const collectMarkdownArchiveBlocks = (
  content: string,
  options: MarkdownArchiveOptions,
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
      path: pathOf(task, nodes, options),
      lines: lines.slice(task.lineNumber, task.endLine),
      taskCount: tasks.filter(
        (node) => node.lineNumber >= task.lineNumber && node.lineNumber < task.endLine
      ).length,
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
  options: MarkdownArchiveOptions,
  intoArchive = true,
  sourceEol = '\n'
): string => {
  if (!blocks.length) return content;
  const eol = content.includes('\r\n') ? '\r\n' : content ? '\n' : sourceEol;
  let lines = content ? splitLines(content) : [];
  const parse = () =>
    parseMarkdownTasks(lines.join(eol), { ...options, scope: 'all', includeEmptyProjects: true });
  const originalTaskCount = parse().filter((node) => node.kind === 'todo').length;
  if (intoArchive && !parse().some((node) => node.archiveRoot)) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push('');
    const archiveLine = lines.length;
    lines.push(`# ${options.archiveName || 'Archive'}`, '');
    if (!parse().some((node) => node.archiveRoot)) {
      lines[archiveLine] = `# ${quoteMarkdownProjectTitle(options.archiveName || 'Archive')}`;
    }
    if (!parse().some((node) => node.archiveRoot))
      throw new Error('Unable to create the Markdown archive heading. Source tasks were kept');
  }
  blocks.forEach((block) => {
    let nodes = parse();
    let target = intoArchive ? nodes.find((node) => node.archiveRoot) : undefined;
    const archive = nodes.find((node) => node.archiveRoot);
    const matchingParents = (names: string[]) =>
      nodes.filter(
        (node) =>
          !node.archiveRoot &&
          node.inArchive === intoArchive &&
          samePath(pathOf(node, nodes, options).concat(pathTitle(node, options)), names)
      );
    if (!intoArchive) {
      // A repeated heading can still have a unique destination farther down
      // the path. Check the deepest existing parent before creating anything.
      for (let depth = block.path.length; depth > 0; depth--) {
        const parents = matchingParents(block.path.slice(0, depth));
        if (!parents.length) continue;
        if (parents.length > 1)
          throw new Error(
            'Multiple Markdown parents match the archived path. Use distinct parent labels; archived tasks were kept'
          );
        break;
      }
    }
    for (let depth = 0; depth < block.path.length; depth++) {
      const names = block.path.slice(0, depth + 1);
      const found = matchingParents(names)[0];
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
      const recreateHeading = !intoArchive && (!target || (target.heading && target.heading < 6));
      const headingPrefix = recreateHeading
        ? `${prefix}${'#'.repeat(target ? target.heading + 1 : 1)} `
        : '';
      const header = recreateHeading
        ? `${headingPrefix}${block.path[depth]}`
        : `${prefix}${block.path[depth]}:`;
      lines.splice(insertAt, 0, header);
      nodes = parse();
      target = nodes.find((node) => node.lineNumber === insertAt);
      const validTarget = () =>
        target &&
        target.kind === 'project' &&
        target.inArchive === intoArchive &&
        samePath(pathOf(target, nodes, options).concat(pathTitle(target, options)), names);
      if (!validTarget()) {
        const title = quoteMarkdownProjectTitle(block.path[depth]);
        lines[insertAt] = recreateHeading ? `${headingPrefix}${title}` : `${prefix}${title}:`;
        nodes = parse();
        target = nodes.find((node) => node.lineNumber === insertAt);
      }
      if (!validTarget())
        throw new Error('Unable to create the Markdown archive project. Source tasks were kept');
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
  if (
    parse().filter((node) => node.kind === 'todo').length !==
    originalTaskCount + blocks.reduce((count, block) => count + block.taskCount, 0)
  ) {
    throw new Error('The Markdown archive could not retain every task. Source tasks were kept');
  }
  return lines.join(eol);
};
