import { maskInlineCode } from './todo-status';
import { splitLines } from './line-splitting';

export interface MarkdownTaskOptions {
  scope?: 'all' | 'sections';
  sections?: string[];
  archiveName?: string;
  includeEmptyProjects?: boolean;
  symbols?: { box?: string; done?: string; cancelled?: string };
}

export interface MarkdownTaskNode {
  kind: 'project' | 'todo';
  lineNumber: number;
  endLine: number;
  level: number;
  parent?: number;
  title: string;
  status?: 'box' | 'done' | 'cancelled';
  markerStart?: number;
  markerEnd?: number;
  style?: 'checkbox' | 'symbol';
  indent: number;
  contentIndent?: number;
  heading?: number;
  inArchive: boolean;
  archiveRoot?: boolean;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indentWidth = (line: string) =>
  (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;
const headingTitle = (text: string) => text.replace(/[ \t]+#+[ \t]*$/, '').trim();

/** Parse task-bearing Markdown blocks, retaining coordinates in the original source. */
export const parseMarkdownTasks = (
  content: string,
  options: MarkdownTaskOptions = {}
): MarkdownTaskNode[] => {
  const lines = splitLines(content);
  const nodes: MarkdownTaskNode[] = [];
  const headings: MarkdownTaskNode[] = [];
  const indented: MarkdownTaskNode[] = [];
  const sections = (options.sections || ['Todo', 'Todos', 'Tasks']).map((name) =>
    name.toLowerCase()
  );
  const symbols = options.symbols || {};
  const symbolNames = Array.from(
    new Set(['☐', '✔', '✘', symbols.box, symbols.done, symbols.cancelled].filter(Boolean))
  );
  const taskPattern = new RegExp(
    `^([ \\t]*)(?:(?:[-+*]|\\d+[.)])[ \\t]+)?(\\[[ xX]\\]|${symbolNames.map(escapeRegex).join('|')})(?=[ \\t]|$)([ \\t]*)(.*)$`
  );
  let fence: { marker: string; length: number; start: number } | undefined;
  const fencedEnds = new Map<number, number>();
  let comment = false;
  let frontMatter =
    lines[0] === '---' && lines.slice(1).some((line) => /^(---|\.\.\.)\s*$/.test(line));

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const raw = lines[lineNumber];
    const indent = indentWidth(raw);
    if (frontMatter) {
      if (lineNumber > 0 && /^(---|\.\.\.)\s*$/.test(raw)) frontMatter = false;
      continue;
    }
    if (fence) {
      const close = raw.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) {
        fencedEnds.set(fence.start, lineNumber + 1);
        fence = undefined;
      }
      continue;
    }
    if (comment) {
      if (raw.includes('-->')) comment = false;
      continue;
    }
    if (/^[ \t]*<!--/.test(raw)) {
      comment = !raw.includes('-->');
      continue;
    }
    const openingFence = raw.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (openingFence) {
      fence = { marker: openingFence[1][0], length: openingFence[1].length, start: lineNumber };
      continue;
    }
    if (!raw.trim() || /^[ \t]*>/.test(raw)) continue;

    const setext =
      indent < 4 &&
      !taskPattern.test(raw) &&
      lines[lineNumber + 1] &&
      /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[lineNumber + 1]);
    const heading =
      raw.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/) ||
      (setext ? ['', setext[1][0] === '=' ? '#' : '##', raw.trim()] : undefined);
    if (heading) {
      while (headings.length && headings[headings.length - 1].heading >= heading[1].length) {
        headings.pop().endLine = lineNumber;
      }
      indented.length = 0;
      const parent = headings[headings.length - 1];
      const title = headingTitle(heading[2]);
      const archiveRoot = title.toLowerCase() === (options.archiveName || 'Archive').toLowerCase();
      const node: MarkdownTaskNode = {
        kind: 'project',
        lineNumber,
        endLine: lines.length,
        level: parent ? parent.level + 1 : 0,
        parent: parent && parent.lineNumber,
        title,
        indent,
        heading: heading[1].length,
        inArchive: archiveRoot || !!(parent && parent.inArchive),
        archiveRoot,
      };
      headings.push(node);
      nodes.push(node);
      if (setext) lineNumber++;
      continue;
    }

    while (indented.length && indent <= indented[indented.length - 1].indent) {
      const previous = indented.pop();
      previous.endLine = lineNumber;
    }
    const parent = indented[indented.length - 1] || headings[headings.length - 1];
    // Four spaces outside a list/project are an indented code block. Inside
    // a task, an additional four spaces beyond its content also introduce code.
    const contentIndent = parent && parent.contentIndent;
    if (
      (!indented.length && indent >= 4) ||
      (contentIndent !== undefined && indent >= contentIndent + 4)
    )
      continue;
    const inArchive = !!(parent && parent.inArchive);
    const inSection = headings.some((node) => sections.includes(node.title.toLowerCase()));
    if (options.scope === 'sections' && !inSection && !inArchive) continue;

    const task = raw.match(taskPattern);
    if (task) {
      const markerStart = raw.indexOf(task[2], task[1].length);
      const marker = task[2];
      const masked = maskInlineCode(task[4]);
      const tagged = (name: string) =>
        new RegExp(`(?:^|[^a-zA-Z0-9])@${name}(?:\\([^)]*\\)|(?![a-zA-Z0-9]))`).test(masked);
      const status =
        tagged('cancelled') ||
        marker === '✘' ||
        (marker === symbols.cancelled && marker !== symbols.box)
          ? 'cancelled'
          : tagged('done') ||
              /^\[[xX]\]$/.test(marker) ||
              marker === '✔' ||
              (marker === symbols.done && marker !== symbols.box)
            ? 'done'
            : 'box';
      const node: MarkdownTaskNode = {
        kind: 'todo',
        lineNumber,
        endLine: lines.length,
        level: parent ? parent.level + 1 : 0,
        parent: parent && parent.lineNumber,
        title: task[4],
        status,
        markerStart,
        markerEnd: markerStart + marker.length,
        style: marker.startsWith('[') ? 'checkbox' : 'symbol',
        indent,
        contentIndent: Math.max(
          indent + 2,
          raw.slice(0, markerStart).replace(/\t/g, '    ').length
        ),
        inArchive,
      };
      nodes.push(node);
      indented.push(node);
      continue;
    }

    // A Todo+ project or an ordinary list item can own nested tasks. Empty
    // groups are removed below, so prose does not become sidebar content.
    const project = raw.match(/^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(.+?):[ \t]*$/);
    const list = raw.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(.+)$/);
    if (project || list) {
      const node: MarkdownTaskNode = {
        kind: 'project',
        lineNumber,
        endLine: lines.length,
        level: parent ? parent.level + 1 : 0,
        parent: parent && parent.lineNumber,
        title: (project || list)[1],
        indent,
        contentIndent: list
          ? raw.slice(0, raw.indexOf(list[1])).replace(/\t/g, '    ').length
          : undefined,
        inArchive,
      };
      nodes.push(node);
      indented.push(node);
    }
  }
  if (fence) fencedEnds.set(fence.start, lines.length);

  // Block ranges include indented notes and children, but leave separating
  // blank lines in place when a task is archived.
  nodes.forEach((node) => {
    if (node.heading) return;
    let end = node.lineNumber + 1;
    for (; end < node.endLine; end++) {
      if (lines[end].trim() && indentWidth(lines[end]) <= node.indent) break;
      if (fencedEnds.has(end)) end = fencedEnds.get(end) - 1;
    }
    while (end > node.lineNumber + 1 && !lines[end - 1].trim()) end--;
    node.endLine = end;
  });
  const byLine = new Map(nodes.map((node): [number, MarkdownTaskNode] => [node.lineNumber, node]));
  const visible = new Set<number>();
  nodes
    .filter((node) => node.kind === 'todo' || node.archiveRoot)
    .forEach((node) => {
      let current = node;
      while (current) {
        visible.add(current.lineNumber);
        current = byLine.get(current.parent);
      }
    });
  return options.includeEmptyProjects
    ? nodes
    : nodes.filter((node) => visible.has(node.lineNumber));
};

export const replaceMarkdownTaskMarker = (
  line: string,
  task: MarkdownTaskNode,
  state: 'box' | 'done' | 'cancelled' | 'other',
  symbols: MarkdownTaskOptions['symbols'] = {}
) => {
  const marker =
    state === 'other'
      ? ''
      : task.style === 'checkbox'
        ? state === 'done'
          ? '[x]'
          : '[ ]'
        : state === 'done'
          ? symbols.done || '✔'
          : state === 'cancelled'
            ? symbols.cancelled || '✘'
            : symbols.box || '☐';
  return line.slice(0, task.markerStart) + marker + line.slice(task.markerEnd);
};
