/* IMPORT */

import * as _ from 'lodash';
import stringMatches from 'string-matches';
import * as vscode from 'vscode';
import Consts from '../consts';
import Utils from '../utils';
import {
  getMarkdownTaskNodes,
  getMarkdownTaskOptions,
  isMarkdownTaskDocument,
} from '../utils/task-source';
import {
  MarkdownTaskNode,
  getMarkdownTaskCreation,
  replaceMarkdownTaskMarker,
} from '../utils/markdown-tasks';
import { removeTodoStatusTag } from '../utils/todo-status';
import {
  getMarkdownCommentRanges,
  maskMarkdownTaskText,
  transformMarkdownTaskText,
} from '../utils/markdown-task-text';
import {
  Line,
  Archive,
  Comment,
  Formatted,
  Project,
  Tag,
  Todo,
  TodoBox,
  TodoFinished,
  TodoDone,
  TodoCancelled,
} from './items';

/* DOCUMENT */

class Document {
  textEditor?: vscode.TextEditor;
  textDocument?: vscode.TextDocument;
  text?: string;

  constructor(res: string | vscode.TextEditor | vscode.TextDocument) {
    if (_.isString(res)) {
      this.text = res;
    } else if (res) {
      if ('document' in res) {
        // => vscode.TextEditor

        this.textEditor = res as vscode.TextEditor; //TSC
        this.textDocument = this.textEditor.document;
      } else {
        // => vscode.TextDocument

        this.textEditor = vscode.window.visibleTextEditors.find((te) => te.document === res);
        this.textDocument = res as vscode.TextDocument; //TSC
      }
    }
  }

  /* GET */

  getItems(
    Item:
      | typeof Line
      | typeof Archive
      | typeof Comment
      | typeof Formatted
      | typeof Project
      | typeof Tag
      | typeof Todo
      | typeof TodoBox
      | typeof TodoFinished
      | typeof TodoDone
      | typeof TodoCancelled,
    regex: RegExp
  ) {
    if (this.isMarkdown()) return this.getMarkdownItems(Item, regex);
    const matchText = _.isString(this.text) ? this.text : this.textDocument.getText(),
      matches = stringMatches(matchText, regex);

    return matches.map((match) => {
      const item = new Item(this.textEditor, undefined, match);

      item.textDocument = this.textDocument;

      return item;
    });
  }

  getItemAt(
    Item:
      | typeof Line
      | typeof Archive
      | typeof Comment
      | typeof Formatted
      | typeof Project
      | typeof Tag
      | typeof Todo
      | typeof TodoBox
      | typeof TodoFinished
      | typeof TodoDone
      | typeof TodoCancelled,
    lineNumber: number,
    checkValidity = true
  ) {
    if (this.isMarkdown()) {
      const item = this.getMarkdownItems(
        Item,
        Item === TodoBox ? Consts.regexes.todo : undefined,
        lineNumber
      ).find((candidate) => candidate.lineNumber === lineNumber);
      return item;
    }
    const line = this.textDocument.lineAt(lineNumber);

    if (checkValidity && !Item.is(line.text)) return;

    const item = new Item(this.textEditor, line);

    item.textDocument = this.textDocument;

    return item;
  }

  getLines() {
    return _.range(this.textDocument.lineCount).map((lineNr) => this.getLineAt(lineNr));
  }

  getLineAt(lineNr: number) {
    return this.getItemAt(Line, lineNr, false);
  }

  getArchive() {
    return this.getItems(Archive, Consts.regexes.archive)[0];
  }

  getComments() {
    return this.getItems(Comment, Consts.regexes.comment);
  }

  getCommentAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(Comment, lineNumber, checkValidity);
  }

  getFormatted() {
    return this.getItems(Formatted, Consts.regexes.formatted);
  }

  getProjects() {
    return this.getItems(Project, Consts.regexes.project);
  }

  getProjectAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(Project, lineNumber, checkValidity);
  }

  getTags() {
    return this.getItems(Tag, Consts.regexes.tagSpecialNormal);
  }

  getTagsDue() {
    return this.getItems(Tag, Consts.regexes.tagDue);
  }

  getTodos() {
    return this.getItems(Todo, Consts.regexes.todo);
  }

  getTodoAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(Todo, lineNumber, checkValidity);
  }

  getTodoForCreationAt(lineNumber: number) {
    if (!this.isMarkdown()) return;
    const creation = getMarkdownTaskCreation(
      this.textDocument.getText(),
      lineNumber,
      getMarkdownTaskOptions()
    );
    return creation ? this.getMarkdownItems(Todo, undefined, lineNumber, creation)[0] : undefined;
  }

  getTodosBox() {
    return this.getItems(TodoBox, Consts.regexes.todo).filter((todo) => todo.isBox());
  }

  getTodoBoxAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(TodoBox, lineNumber, checkValidity);
  }

  getTodosBoxStarted() {
    return this.getItems(TodoBox, Consts.regexes.todoBoxStarted);
  }

  getTodosDone() {
    return this.getItems(TodoDone, Consts.regexes.todo).filter((todo) => todo.isDone());
  }

  getTodoDoneAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(TodoDone, lineNumber, checkValidity);
  }

  getTodosCancelled() {
    return this.getItems(TodoCancelled, Consts.regexes.todo).filter((todo) => todo.isCancelled());
  }

  getTodoCancelledAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(TodoCancelled, lineNumber, checkValidity);
  }

  getTodosFinished() {
    return this.getItems(TodoFinished, Consts.regexes.todo).filter((todo) => todo.isFinished());
  }

  getTodoFinishedAt(lineNumber: number, checkValidity?) {
    return this.getItemAt(TodoFinished, lineNumber, checkValidity);
  }

  /* IS */

  isMarkdown() {
    return !!this.textDocument && isMarkdownTaskDocument(this.textDocument);
  }

  /** Source adapter: domain items keep their real source lines and native edits. */
  private getMarkdownItems(
    Item,
    regex?: RegExp,
    lineNumber?: number,
    creation?: { node: MarkdownTaskNode; text: string }
  ): any[] {
    const nodes = creation ? [creation.node] : getMarkdownTaskNodes(this.textDocument);
    const todoType = Item === Todo || Item.prototype instanceof Todo;
    if (Item === Comment || Item === Formatted || Item === Line) return [];
    const items = [];
    nodes.forEach((node) => {
      if (lineNumber !== undefined && node.lineNumber !== lineNumber) return;
      if (todoType && node.kind !== 'todo') return;
      if ((Item === Project || Item === Archive) && node.kind !== 'project') return;
      if (Item === Archive && !node.archiveRoot) return;
      if (Item === TodoBox && node.status !== 'box') return;
      if (Item === TodoDone && node.status !== 'done') return;
      if (Item === TodoCancelled && node.status !== 'cancelled') return;
      if (Item === TodoFinished && node.status === 'box') return;
      const line = this.textDocument.lineAt(node.lineNumber);
      if (Item === Tag) {
        if (node.kind !== 'todo') return;
        stringMatches(maskMarkdownTaskText(line.text), regex).forEach((match) => {
          const tag = new Item(this.textEditor, line, match);
          const range = Utils.regex.match2range(match);
          tag._range = new vscode.Range(node.lineNumber, range.start, node.lineNumber, range.end);
          tag._pos = tag._range.start;
          tag.textDocument = this.textDocument;
          tag.markdownNode = node;
          items.push(tag);
        });
        return;
      }
      const item = new Item(this.textEditor, line);
      item.textDocument = this.textDocument;
      item.markdownNode = node;
      item.level = node.level;
      if (todoType) {
        item.getTimekeepingText = () => maskMarkdownTaskText(item.lineNextText);
        item.getTag = (pattern: RegExp) => {
          pattern.lastIndex = 0;
          const match = pattern.exec(maskMarkdownTaskText(item.lineNextText));
          return match && item.lineNextText.slice(match.index, match.index + match[0].length);
        };
        item.hasTag = (pattern: RegExp) => !!item.getTag(pattern);
        item.removeTag = (pattern: RegExp) => {
          item.lineNextText = removeTodoStatusTag(
            item.lineNextText,
            pattern,
            maskMarkdownTaskText
          ).trimEnd();
        };
        item.unfinish = () => {
          item.removeTag(Consts.regexes.tagFinished);
          item.removeTag(Consts.regexes.tagElapsed);
        };
        item.removeTags = (tags: string[]) => {
          item.lineNextText = transformMarkdownTaskText(item.lineNextText, (text) =>
            Utils.tags.remove(text, tags)
          );
        };
        item.addTag = (tag: string) => {
          const ranges = getMarkdownCommentRanges(item.lineNextText);
          const comment = ranges.length ? ranges[0].start : -1;
          item.lineNextText =
            comment < 0
              ? `${item.lineNextText.trimEnd()} ${tag}`
              : `${item.lineNextText.slice(0, comment).trimEnd()} ${tag} ${item.lineNextText.slice(comment)}`;
        };
        item.isBox = () => node.status === 'box';
        item.isDone = () => node.status === 'done';
        item.isCancelled = () => node.status === 'cancelled';
        item.setSymbolAndState = (symbol, state) => {
          const was = item.getStatus();
          item.lineNextText = creation
            ? creation.text
            : replaceMarkdownTaskMarker(item.lineNextText, node, state, Consts.symbols);
          if (state === 'done' || state === 'cancelled') item.unfinish();
          item.setStatus(item.makeStatus(state), was);
          if (
            state === 'cancelled' &&
            node.style === 'checkbox' &&
            !/@cancelled(?:\(|\b)/.test(maskMarkdownTaskText(item.lineNextText))
          ) {
            item.addTag('@cancelled');
          }
        };
        if (regex === Consts.regexes.todoBoxStarted && !item.hasTag(Consts.regexes.tagStarted))
          return;
      }
      items.push(item);
    });
    return items;
  }

  isSupported() {
    return Utils.editor.isSupported(this.textEditor);
  }
}

/* EXPORT */

export default Document;
