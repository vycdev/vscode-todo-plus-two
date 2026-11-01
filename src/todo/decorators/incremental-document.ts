import * as _ from 'lodash';
import { EndOfLine, Range } from 'vscode';
import type { TextDocumentContentChangeEvent, TextEditor, TextEditorDecorationType } from 'vscode';
import Config from '../../config';
import Consts from '../../consts';
import Utils from '../../utils';
import AST from '../../utils/ast';
import Due from '../../utils/due';
import { parseCodeBlocks } from '../../utils/code-blocks';
import Tokens from '../../utils/statistics_tokens';
import { getEstimateDuration, isFixedEstimateDuration } from '../../utils/estimate';
import DocumentModule from '../document';
import type Item from '../items/item';
import { DocumentLinesCache } from './document-lines-cache';
import { ProjectStatisticsCache } from './project-statistics-cache';

type Items = ReturnType<typeof import('./document').default.getItems>;
type Decoration = { type: TextEditorDecorationType; ranges: any[] };
const arrayKeys = [
  'comments',
  'formatted',
  'projects',
  'tags',
  'tagsDue',
  'todosBox',
  'todosStarted',
  'todosDone',
  'todosCancelled',
] as const;
const scalarKeys = [
  'comments',
  'projects',
  'tags',
  'pending',
  'done',
  'cancelled',
  'estSeconds',
  'estTotalSeconds',
  'lastedSeconds',
  'wastedSeconds',
] as const;
const emptyItems = (): Items => ({
  archive: undefined,
  comments: [],
  formatted: [],
  projects: [],
  tags: [],
  tagsDue: [],
  todosBox: [],
  todosStarted: [],
  todosDone: [],
  todosCancelled: [],
});
const eachItem = (items: Items, run: (item: Item) => void) => {
  if (items.archive) run(items.archive);
  arrayKeys.forEach((key) => items[key].forEach(run));
};

// The canonical regexes allow both multiline tag arguments and whitespace
// separators spanning lines after a task marker. Preserve those semantics by
// rebuilding until the input is safe to parse one line at a time. Fenced code
// notes also require whole-document context to exclude examples from the model.
export const hasMultilineSyntax = (text: string) => {
  if (parseCodeBlocks(text).blocks.length) return true;
  const symbols = [Consts.symbols.box, Consts.symbols.done, Consts.symbols.cancelled];
  return text.split(/\r?\n/).some((line) => {
    // An argument is unfinished only if '@...(' occurs after the last ')'.
    // Scan directly: a greedy regex retries at every '@' on long tag-like lines.
    const tag = line.indexOf('@', line.lastIndexOf(')') + 1);
    if (tag >= 0 && line.indexOf('(', tag + 1) >= 0) return true;
    // Markdown checkbox prefixes allow a newline between '-' and '[ ]'.
    if (line.trim() === '-') return true;
    // A longer configured symbol may overlap a shorter default symbol; check
    // it separately before the regex can prefer the shorter alternative.
    if (
      symbols.some(
        (symbol) =>
          typeof symbol === 'string' &&
          symbol.length &&
          line.endsWith(symbol) &&
          /^[^\S\r\n]*$/.test(line.slice(0, -symbol.length))
      )
    )
      return true;
    Consts.regexes.todoSymbol.lastIndex = 0;
    const marker = Consts.regexes.todoSymbol.exec(line + '\n');
    return !!marker && marker[0].includes('\n');
  });
};

interface Line {
  text: string;
  lineNumber: number;
  level: number;
  items: Items;
  signature: string;
  dynamic: boolean;
  dynamicDue: boolean;
  contribution?: Tokens;
  decorations: Map<TextEditorDecorationType, any[]>;
}

// Store ranges relative to their line. Inserting lines changes coordinates, not
// the cached highlighting or regex results for every subsequent line.
const shiftRange = (value, delta: number) => {
  const range = value.range || value;
  const shifted = new Range(
    range.start.line + delta,
    range.start.character,
    range.end.line + delta,
    range.end.character
  );
  return value.range ? { ...value, range: shifted } : shifted;
};

export class IncrementalDocument {
  private readonly lines: DocumentLinesCache<Line>;
  private readonly projects = new ProjectStatisticsCache<Line>();
  private readonly types = new Set<TextEditorDecorationType>();
  private readonly patterns = Consts.regexes;
  private readonly day = new Date().toDateString();
  private readonly tabSize;
  private readonly insertSpaces;
  private readonly indentation: string;
  private readonly eol;
  private global: Tokens;
  private projectTokens: Record<number, Tokens>;
  private readonly dynamicLines = new Set<Line>();
  private readonly dynamicDueLines = new Set<Line>();
  private projectLines: Line[];
  private archiveLine?: number;
  private readonly statisticsEnabled =
    Config.getKey('statistics.statusbar.enabled') !== false ||
    Config.getKey('statistics.project.enabled') !== false;

  constructor(
    private editor: TextEditor,
    text: string,
    items: Items,
    decorations: Decoration[],
    private parseItems: (doc: DocumentModule) => Items,
    private decorateItems: (items: Items) => Decoration[]
  ) {
    this.tabSize = editor.options?.tabSize;
    this.insertSpaces = editor.options?.insertSpaces;
    this.indentation = AST.getIndentation(editor.document);
    this.eol = editor.document.eol;
    this.global = Utils.statistics.tokens.global as Tokens;
    this.projectTokens = Utils.statistics.tokens.projects;
    this.lines = new DocumentLinesCache(editor.document, text, (line, lineNumber) =>
      this.makeLine(line, lineNumber, emptyItems())
    );
    eachItem(items, (item) => {
      const line = this.lines.lines[item.lineNumber];
      if (item === items.archive) line.items.archive = item as any;
    });
    arrayKeys.forEach((key) =>
      items[key].forEach((item) => this.lines.lines[item.lineNumber].items[key].push(item as any))
    );
    for (const line of this.lines.lines) {
      this.describe(line);
      if (line.dynamic) this.dynamicLines.add(line);
      if (line.dynamicDue) this.dynamicDueLines.add(line);
    }
    this.projectLines = this.lines.lines.filter((line) => line.items.projects.length);
    this.archiveLine = this.lines.lines.find((line) => line.items.archive)?.lineNumber;
    for (const { type, ranges } of decorations) {
      this.types.add(type);
      for (const value of ranges) {
        const range = value.range || value,
          line = this.lines.lines[range.start.line];
        if (!line.decorations.has(type)) line.decorations.set(type, []);
        line.decorations.get(type).push(shiftRange(value, -line.lineNumber));
      }
    }
    const prepared = this.projects.prepare(this.lines.lines, [], []);
    this.projects.store(prepared.scopes, this.projectTokens);
  }

  matches(editor: TextEditor) {
    return (
      this.editor === editor &&
      this.patterns === Consts.regexes &&
      this.tabSize === editor.options?.tabSize &&
      this.insertSpaces === editor.options?.insertSpaces &&
      this.indentation === AST.getIndentation(editor.document) &&
      this.eol === editor.document.eol &&
      this.day === new Date().toDateString()
    );
  }

  // Keep clock-driven overlays in sync with ranges retained for future edits.
  replaceDecorations(decorations: Decoration[]) {
    const types = new Set(decorations.map(({ type }) => type));
    for (const line of this.lines.lines) types.forEach((type) => line.decorations.delete(type));
    for (const { type, ranges } of decorations) {
      if (ranges.length) this.types.add(type);
      else this.types.delete(type);
      for (const value of ranges) {
        const range = value.range || value;
        const line = this.lines.lines[range.start.line];
        if (!line) continue;
        if (!line.decorations.has(type)) line.decorations.set(type, []);
        line.decorations.get(type).push(shiftRange(value, -line.lineNumber));
      }
    }
  }

  private makeLine(text: string, lineNumber: number, items: Items): Line {
    return {
      text,
      lineNumber,
      items,
      level: AST.getLevel(this.editor.document, text),
      signature: '',
      dynamic: false,
      dynamicDue: false,
      decorations: new Map(),
    };
  }

  private describe(line: Line) {
    const items = line.items;
    // The public document model exposes only the first Archive match. Keep all
    // candidates so removing that header can reveal the next one correctly.
    Consts.regexes.archive.lastIndex = 0;
    if (!items.archive && Consts.regexes.archive.test(line.text)) {
      const doc = new DocumentModule(line.text);
      doc.textEditor = this.editor;
      doc.textDocument = this.editor.document;
      items.archive = doc.getArchive();
      items.archive.rebase(line.lineNumber, items.archive.matchRange.start);
    }
    line.signature = JSON.stringify([
      line.level,
      !!items.archive,
      items.projects.length,
      items.comments.length,
      items.todosBox.length,
      items.todosDone.length,
      items.todosCancelled.length,
      items.tags.map((tag) => tag.text),
    ]);
    line.dynamic = items.tags.some((tag) => {
      const duration = getEstimateDuration(tag.text);
      return duration !== undefined && !isFixedEstimateDuration(duration);
    });
    line.dynamicDue = items.tagsDue.some((tag) => {
      const date = Due.extract(tag.text);
      return date && !/^\d{2,4}[-/]\d{1,2}[-/]\d{1,4}(?:[ T].*)?$/.test(date);
    });
  }

  private parse(text: string, lineNumber: number) {
    if (hasMultilineSyntax(text)) return;
    const doc = new DocumentModule(
      text +
        (this.eol === EndOfLine.CRLF && lineNumber < this.editor.document.lineCount - 1 ? '\r' : '')
    );
    doc.textEditor = this.editor;
    doc.textDocument = this.editor.document;
    const items = this.parseItems(doc),
      line = this.makeLine(text, lineNumber, items);
    eachItem(items, (item) =>
      item.rebase(lineNumber, item.matchRange.start, {
        text,
        lineNumber,
        range: new Range(lineNumber, 0, lineNumber, text.length),
      } as any)
    );
    this.describe(line);
    return line;
  }

  private collect() {
    const items = emptyItems();
    for (const line of this.lines.lines) {
      if (!items.archive && line.items.archive) items.archive = line.items.archive;
      arrayKeys.forEach((key) => items[key].push(...(line.items[key] as any)));
    }
    return items;
  }

  update(changes: readonly TextDocumentContentChangeEvent[]) {
    const previousLines = new Map<number, Line>();
    // The line cache validates version/coordinates and checks every replacement
    // before committing any of them.
    const result = this.lines.update(this.editor.document, changes, (text, line) =>
      this.parse(text, line)
    );
    if (!result) return;
    const { groups, removed, added, structural } = result;
    const oldRecords = removed.map((line) => ({
      items: line.items,
      lineNumber: line.lineNumber,
      contribution: line.contribution,
      dynamic: line.dynamic,
    }));
    const wasStarted = removed.some((line) => line.items.todosStarted.length);
    removed.forEach((line) => this.dynamicLines.delete(line));
    removed.forEach((line) => this.dynamicDueLines.delete(line));
    removed.forEach((line) => previousLines.set(line.lineNumber, line));
    const previousChanges = [],
      nextChanges = [];
    for (const group of groups) {
      let changed = group.delta !== 0;
      for (let index = group.nextStart; index <= group.nextEnd; index++) {
        const next = this.lines.lines[index],
          previous = previousLines.get(group.start + index - group.nextStart);
        if (!previous || previous.signature !== next.signature) changed = true;
        // Preserve stable line identities for scope boundaries and project caches.
        if (!group.delta && previous) {
          next.contribution =
            previous.signature === next.signature ? previous.contribution : undefined;
          const oldDecorations = previous.decorations;
          Object.assign(previous, next, { decorations: oldDecorations });
          this.lines.lines[index] = previous;
        }
        if (this.lines.lines[index].dynamic) this.dynamicLines.add(this.lines.lines[index]);
        if (this.lines.lines[index].dynamicDue) this.dynamicDueLines.add(this.lines.lines[index]);
      }
      if (changed) {
        previousChanges.push({ start: group.start, end: group.end });
        nextChanges.push({ start: group.nextStart, end: group.nextEnd });
      }
    }
    if (structural)
      this.lines.lines.forEach((line, index) => {
        if (line.lineNumber !== index) {
          line.lineNumber = index;
          eachItem(line.items, (item) => item.rebase(index));
        }
      });

    const statistics = Utils.statistics.tokens,
      previousGlobal = this.global,
      previousProjects = this.projectTokens,
      dynamic = this.dynamicLines.size > 0,
      statisticsChanged = previousChanges.length > 0 || dynamic;
    statistics.global = this.global;
    statistics.projects = this.projectTokens;
    let items: Items;
    if (this.statisticsEnabled && (statisticsChanged || structural)) {
      items = this.collect();
      this.projectLines = items.projects.map((project) => this.lines.lines[project.lineNumber]);
      const tokens = new Tokens(),
        archive = items.archive?.lineNumber,
        ignoreArchive = Config.getKey('statistics.statusbar.ignoreArchive');
      const previousArchive = this.archiveLine;
      this.archiveLine = archive;
      const included = (line: number) => !ignoreArchive || archive === undefined || line < archive;
      const changedRecords = groups.reduce(
        (all: Line[], group) =>
          all.concat(this.lines.lines.slice(group.nextStart, group.nextEnd + 1)),
        []
      );
      // Ordinary count/duration edits can update totals by delta. Tagged selectors,
      // calendar estimates, fractional durations and archive moves retain exact
      // canonical aggregation order using cached per-line contributions.
      const canDelta =
        !structural &&
        !dynamic &&
        !oldRecords.some((line) => line.dynamic) &&
        previousArchive === archive &&
        statistics.disabled.global.tagged === true &&
        scalarKeys.every((key) => Number.isSafeInteger(previousGlobal[key]));
      const before = canDelta
        ? oldRecords
            .filter((line) => included(line.lineNumber))
            .map((line) => line.contribution || statistics.createGlobal(line.items, false))
        : [];
      const after = canDelta
        ? changedRecords
            .filter((line) => included(line.lineNumber))
            .map(
              (line) =>
                line.contribution ||
                (line.contribution = statistics.createGlobal(line.items, false))
            )
        : [];
      if (
        canDelta &&
        before
          .concat(after)
          .every((value) => scalarKeys.every((key) => Number.isSafeInteger(value[key])))
      ) {
        scalarKeys.forEach((key) => {
          tokens[key] = previousGlobal[key];
          before.forEach((value) => (tokens[key] -= value[key]));
          after.forEach((value) => (tokens[key] += value[key]));
        });
      } else {
        for (const line of this.lines.lines) {
          if (!included(line.lineNumber)) break;
          if (!line.contribution || line.dynamic)
            line.contribution = statistics.createGlobal(line.items, false);
          scalarKeys.forEach((key) => (tokens[key] += line.contribution[key]));
          tokens.taggedTodos.push(...line.contribution.taggedTodos);
        }
      }
      this.global =
        scalarKeys.every((key) => tokens[key] === previousGlobal[key]) &&
        _.isEqual(tokens.taggedTodos, previousGlobal.taggedTodos)
          ? previousGlobal
          : tokens;
      statistics.global = this.global;
      const prepared = this.projects.prepare(this.lines.lines, previousChanges, nextChanges);
      if (Config.getKey('statistics.project.enabled') !== false) {
        statistics.updateProjects(this.editor.document, items, prepared.reusable);
        this.projectTokens = statistics.projects;
      }
      this.projects.store(prepared.scopes, this.projectTokens);
    }

    const dirty = new Set<Line>();
    this.dynamicDueLines.forEach((line) => dirty.add(line));
    groups.forEach((group) => {
      for (let line = group.nextStart; line <= group.nextEnd; line++)
        dirty.add(this.lines.lines[line]);
    });
    if (this.global !== previousGlobal || this.projectTokens !== previousProjects)
      for (const line of this.projectLines) {
        if (
          this.global !== previousGlobal ||
          this.projectTokens[line.lineNumber] !== previousProjects[line.lineNumber]
        )
          dirty.add(line);
      }
    const changedTypes = new Set<TextEditorDecorationType>();
    removed.forEach((line) => line.decorations.forEach((_, type) => changedTypes.add(type)));
    for (const line of dirty) {
      line.decorations.forEach((_, type) => changedTypes.add(type));
      const next = new Map<TextEditorDecorationType, any[]>();
      for (const { type, ranges } of this.decorateItems(line.items)) {
        if (ranges.length) {
          this.types.add(type);
          next.set(
            type,
            ranges.map((range) => shiftRange(range, -line.lineNumber))
          );
          changedTypes.add(type);
        }
      }
      line.decorations = next;
    }
    if (structural) this.types.forEach((type) => changedTypes.add(type));
    changedTypes.forEach((type) => {
      const ranges = [];
      for (const line of this.lines.lines)
        for (const range of line.decorations.get(type) || [])
          ranges.push(shiftRange(range, line.lineNumber));
      this.editor.setDecorations(type, ranges);
      if (!ranges.length) this.types.delete(type);
    });
    statistics.global = this.global;
    statistics.projects = this.projectTokens;
    const timerChanged =
      structural || wasStarted || added.some((line) => line.items.todosStarted.length);
    return {
      types: Array.from(this.types),
      globalChanged: this.global !== previousGlobal,
      timerChanged,
      started: () => (items || this.collect()).todosStarted,
    };
  }
}
