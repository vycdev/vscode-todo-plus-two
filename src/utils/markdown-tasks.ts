import { splitLines } from './line-splitting';
import { getMarkdownCommentRanges, maskMarkdownTaskText } from './markdown-task-text';

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
  headingOwner?: number;
  inArchive: boolean;
  archiveRoot?: boolean;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indentWidth = (line: string) =>
  (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;
const headingTitle = (text: string) => text.replace(/[ \t]+#+[ \t]*$/, '').trim();
const projectTitle = (text: string) =>
  /^\*\*[\s\S]*\*\*$/.test(text) ? text.slice(2, -2).replace(/\\([!-/:-@[-`{-~])/g, '$1') : text;

/** Literal project labels remain readable even when their text resembles syntax. */
export const quoteMarkdownProjectTitle = (title: string): string =>
  `**${title.replace(/[!-/:-@[-`{-~]/g, '\\$&')}**`;

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
  ).sort((left, right) => right.length - left.length);
  const taskPattern = new RegExp(
    `^([ \\t]*)(?:(?:[-+*]|\\d+[.)])[ \\t]+)?(\\[[ xX]\\]|${symbolNames.map(escapeRegex).join('|')})(?=[ \\t]|$)([ \\t]*)(.*)$`
  );
  let fence: { marker: string; length: number; start: number; baseIndent: number } | undefined;
  const ignoredEnds = new Map<number, number>();
  let comment = false;
  let commentStart = 0;
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
      if (
        close &&
        indent <= fence.baseIndent + 3 &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.length
      ) {
        ignoredEnds.set(fence.start, lineNumber + 1);
        fence = undefined;
      }
      continue;
    }
    const wasComment = comment;
    let cursor = 0;
    if (comment) {
      const closing = raw.indexOf('-->');
      if (closing < 0) continue;
      ignoredEnds.set(commentStart, lineNumber + 1);
      comment = false;
      cursor = closing + 3;
    }
    if (!wasComment && !raw.trim()) continue;
    if (!wasComment) {
      while (indented.length && indent <= indented[indented.length - 1].indent) {
        indented.pop().endLine = lineNumber;
      }
      while (
        headings.length &&
        headings[headings.length - 1].headingOwner !== undefined &&
        !indented.some((node) => node.lineNumber === headings[headings.length - 1].headingOwner)
      ) {
        headings.pop().endLine = lineNumber;
      }
    }
    const container = indented
      .slice()
      .reverse()
      .find((node) => node.indent < indent);
    const fenceBase = container
      ? container.contentIndent === undefined
        ? container.indent + 2
        : container.contentIndent
      : 0;
    if (
      !wasComment &&
      (!container || container.contentIndent !== undefined) &&
      indent >= fenceBase + 4
    )
      continue;
    const openingFence = raw.match(/^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/);
    if (
      !wasComment &&
      openingFence &&
      indent <= fenceBase + 3 &&
      !(openingFence[2][0] === '`' && openingFence[3].includes('`'))
    ) {
      fence = {
        marker: openingFence[2][0],
        length: openingFence[2].length,
        start: lineNumber,
        baseIndent: openingFence[1].trim()
          ? openingFence[1].replace(/\t/g, '    ').length
          : fenceBase,
      };
      continue;
    }
    const comments = getMarkdownCommentRanges(raw.slice(cursor));
    comments.forEach((range) => {
      if (!range.closed) {
        comment = true;
        commentStart = lineNumber;
      }
    });
    if (wasComment || (comments.length && !raw.slice(0, cursor + comments[0].start).trim()))
      continue;
    if (!raw.trim() || /^[ \t]*>/.test(raw)) continue;

    const setext =
      indent <= fenceBase + 3 &&
      !taskPattern.test(raw) &&
      !/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(raw) &&
      lines[lineNumber + 1] &&
      indentWidth(lines[lineNumber + 1]) <= fenceBase + 3 &&
      /^[ \t]*(=+|-+)[ \t]*$/.exec(lines[lineNumber + 1]);
    const heading =
      raw.match(/^[ \t]*(#{1,6})[ \t]+(.+?)\s*$/) ||
      (setext ? ['', setext[1][0] === '=' ? '#' : '##', raw.trim()] : undefined);
    if (heading) {
      const owner = container && container.lineNumber;
      while (
        headings.length &&
        headings[headings.length - 1].headingOwner === owner &&
        headings[headings.length - 1].heading >= heading[1].length
      ) {
        headings.pop().endLine = lineNumber;
      }
      if (owner === undefined) indented.length = 0;
      const section = headings[headings.length - 1];
      const parent = section && section.headingOwner === owner ? section : container;
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
        headingOwner: owner,
        inArchive: archiveRoot || !!(parent && parent.inArchive),
        archiveRoot,
      };
      headings.push(node);
      nodes.push(node);
      if (setext) lineNumber++;
      continue;
    }

    const listParent = indented[indented.length - 1];
    const sectionParent = headings[headings.length - 1];
    const parent =
      listParent && (!sectionParent || listParent.lineNumber > sectionParent.lineNumber)
        ? listParent
        : sectionParent;
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
      const masked = maskMarkdownTaskText(task[4]);
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
        style: /^\[[ xX]\]$/.test(marker) ? 'checkbox' : 'symbol',
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
        title: project ? projectTitle(project[1]) : list[1],
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
  if (fence) ignoredEnds.set(fence.start, lines.length);
  if (comment) ignoredEnds.set(commentStart, lines.length);

  // Block ranges include indented notes and children, but leave separating
  // blank lines in place when a task is archived.
  nodes.forEach((node) => {
    if (node.heading) return;
    let end = ignoredEnds.get(node.lineNumber) || node.lineNumber + 1;
    for (; end < node.endLine; end++) {
      if (lines[end].trim() && indentWidth(lines[end]) <= node.indent) break;
      if (ignoredEnds.has(end)) end = ignoredEnds.get(end) - 1;
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
  if (state === 'other') {
    return line.slice(0, task.markerStart) + line.slice(task.markerEnd).replace(/^[ \t]+/, '');
  }
  const marker =
    task.style === 'checkbox'
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

/** Explicit box creation is allowed only where the resulting task can be parsed. */
export const getMarkdownTaskCreation = (
  content: string,
  lineNumber: number,
  options: MarkdownTaskOptions
): { node: MarkdownTaskNode; text: string } | undefined => {
  const lines = splitLines(content);
  const raw = lines[lineNumber];
  if (
    raw === undefined ||
    /^[ \t]*(?:>|#{1,6}(?:\s|$)|(?:(?:[-+*]|\d+[.)])[ \t]+)?(?:`{3,}|~{3,})|<!--|(?:---|\.\.\.)\s*$)/.test(
      raw
    )
  )
    return;
  const headings = parseMarkdownTasks(content, { ...options, includeEmptyProjects: true }).filter(
    (node) => node.heading
  );
  if (
    headings.some(
      (node) =>
        node.lineNumber === lineNumber ||
        (node.lineNumber === lineNumber - 1 && /^[ \t]*(=+|-+)[ \t]*$/.test(raw))
    )
  )
    return;
  const list = raw.match(/^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)(.*)$/);
  const indentation = (raw.match(/^[ \t]*/) || [''])[0];
  const text = list
    ? `${list[1]}[ ] ${list[2]}`
    : `${indentation}- [ ] ${raw.slice(indentation.length)}`;
  lines[lineNumber] = text;
  const node = parseMarkdownTasks(
    lines.join(content.includes('\r\n') ? '\r\n' : '\n'),
    options
  ).find((candidate) => candidate.kind === 'todo' && candidate.lineNumber === lineNumber);
  return node ? { node: { ...node, status: undefined }, text } : undefined;
};
