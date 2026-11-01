import type { TextDocument, TextDocumentContentChangeEvent } from 'vscode';

export interface ChangedLines {
  start: number;
  end: number;
}

// Ranges use the previous document. Merge edits sharing an old line before
// translating them to final coordinates, including multi-cursor insertions.
export const getChangedLines = (changes: readonly TextDocumentContentChangeEvent[]) => {
  const groups: (ChangedLines & { delta: number; nextStart?: number; nextEnd?: number })[] = [];
  for (const change of [...changes].sort((a, b) => a.range.start.line - b.range.start.line)) {
    const start = change.range.start.line,
      end = change.range.end.line,
      delta = change.text.split(/\r\n|\r|\n/).length - 1 - (end - start),
      previous = groups[groups.length - 1];
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
      previous.delta += delta;
    } else groups.push({ start, end, delta });
  }
  let offset = 0;
  for (const group of groups) {
    group.nextStart = group.start + offset;
    group.nextEnd = group.end + offset + group.delta;
    offset += group.delta;
  }
  return groups;
};

export class DocumentLinesCache<T> {
  lines: T[];
  private version: number;
  readonly crlf: boolean;

  constructor(document: TextDocument, text: string, parse: (text: string, line: number) => T) {
    this.version = document.version;
    this.crlf = text.includes('\r\n');
    this.lines = text.split('\n').map((line, index) => parse(line.replace(/\r$/, ''), index));
  }

  update(
    document: TextDocument,
    changes: readonly TextDocumentContentChangeEvent[],
    parse: (text: string, line: number) => T | undefined
  ) {
    if (!changes.length || document.version !== this.version + 1) return;
    const groups = getChangedLines(changes);
    if (
      this.lines.length + groups.reduce((sum, group) => sum + group.delta, 0) !==
      document.lineCount
    )
      return;

    const replacements: { group: (typeof groups)[number]; lines: T[] }[] = [];
    for (const group of groups) {
      if (group.start < 0 || group.end >= this.lines.length || group.nextEnd < group.nextStart)
        return;
      const lines: T[] = [];
      for (let line = group.nextStart; line <= group.nextEnd; line++) {
        const parsed = parse(document.lineAt(line).text, line);
        if (!parsed) return;
        lines.push(parsed);
      }
      replacements.push({ group, lines });
    }
    const removed = replacements.reduce(
      (all: T[], { group }) => all.concat(this.lines.slice(group.start, group.end + 1)),
      []
    );
    // Check every replacement before changing the cached snapshot.
    for (const { group, lines } of [...replacements].reverse()) {
      if (lines.length > 1000)
        this.lines = this.lines
          .slice(0, group.start)
          .concat(lines, this.lines.slice(group.end + 1));
      else this.lines.splice(group.start, group.end - group.start + 1, ...lines);
    }
    this.version = document.version;
    return {
      groups,
      removed,
      added: replacements.reduce((all: T[], { lines }) => all.concat(lines), []),
      structural: groups.some(({ delta }) => delta !== 0),
    };
  }
}
