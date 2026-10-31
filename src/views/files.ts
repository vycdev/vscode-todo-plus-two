/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Utils from '../utils';
import Consts from '../consts';
import { hasUnfinishedTodo, matchesFilesViewFilter } from '../utils/files-view-filter';
import { matchesTodoStatus } from '../utils/todo-status';
import {
  countPendingTodos,
  supportsActivityBarBadge,
  updateActivityBarBadge,
} from '../utils/activity-bar-badge';
import Tags from '../utils/tags';
import File from './items/file';
import Item from './items/item';
import Group from './items/group';
import Placeholder from './items/placeholder';
import Todo from './items/todo';
import View from './view';
import { getMarkdownTaskNodes, isMarkdownTaskDocument } from '../utils/task-source';

/* FILES */

//TODO: Collapse/Expand without rebuilding the tree https://github.com/Microsoft/vscode/issues/54192

class Files extends View {
  id = 'todo.views.1files';
  clear = false;
  expanded = false;
  filter: string | false = false;
  showFinishedOverride: boolean;
  filePathRe = /^(?!~).*(?:\\|\/)/;

  get showFinished() {
    return _.isBoolean(this.showFinishedOverride)
      ? this.showFinishedOverride
      : _.get(this.config, 'file.view.showFinished') !== false;
  }

  set showFinished(value: boolean) {
    this.showFinishedOverride = value;
  }

  getTreeItem(item: Item): vscode.TreeItem {
    if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
      item.collapsibleState = this.expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
    }

    return item;
  }

  async getChildren(item?: Item): Promise<Item[]> {
    if (this.clear) {
      this.deferRefresh();

      return [];
    }

    let obj;

    if (item) {
      obj = item.obj;
    } else {
      obj = await Utils.files.get(undefined, this.filter);
      this.updateActivityBarBadge();
    }

    while (obj && '' in obj) obj = obj['']; // Collapsing unnecessary groups

    if (_.isEmpty(obj)) {
      return [
        new Placeholder(this.filter ? 'No matching todo files found' : 'No todo files found'),
      ];
    }

    if (obj.textEditor) {
      if (isMarkdownTaskDocument(obj.textEditor)) return this.getMarkdownChildren(obj);
      const items = [],
        lineNr = obj.hasOwnProperty('lineNr') ? obj.lineNr : -1;

      Utils.ast.walkChildren(obj.textEditor, lineNr, (data) => {
        data.textEditor = obj.textEditor;
        data.filePath = obj.filePath;
        data.lineNr = data.line.lineNumber;

        let isGroup = false;

        Utils.ast.walkChildren(obj.textEditor, data.line.lineNumber, () => {
          isGroup = true;
          return false;
        });

        const showComments = this.config.file.view.showComments === true;
        const isCommentLine = !!(
          Consts &&
          Consts.regexes &&
          data.line &&
          data.line.text &&
          data.line.text.match(Consts.regexes.comment)
        );
        if (!showComments && isCommentLine) return;
        if (
          !this.showFinished &&
          this.isFinishedTodo(data.line.text) &&
          (!isGroup || !this.hasUnfinishedDescendant(obj.textEditor, data.line.lineNumber))
        )
          return;
        if (!this.matchesFilter(obj.textEditor, data.line.lineNumber, obj.filePath)) return;

        const lineText = _.trimStart(data.line.text),
          label = this.config.file.view.showTags === false ? Tags.removeAll(lineText) : lineText,
          item = isGroup ? new Group(data, label) : new Todo(data, label);

        item.contextValue = data.line.text.match(Consts.regexes.todo)
          ? 'todo'
          : isGroup
            ? 'group'
            : 'item';

        items.push(item);
      });

      if (!items.length) {
        return [
          new Placeholder(
            this.filter
              ? 'No matching tasks found'
              : this.showFinished
                ? 'The file is empty'
                : 'No unfinished tasks found'
          ),
        ];
      }

      return items;
    } else {
      const keys = Object.keys(obj).sort();

      return keys.map((key) => {
        const val = obj[key];

        if (this.filePathRe.test(key)) {
          const uri = Utils.view.getURI(val);

          return new File(val, uri);
        } else {
          return new Group(val, key, this.config.file.view.icons);
        }
      });
    }
  }

  refresh(clear?) {
    this.clear = !!clear;

    super.refresh();

    this.refreshActivityBarBadge();

    vscode.commands.executeCommand('setContext', 'todo-files-show-finished', this.showFinished);
  }

  private getMarkdownChildren(obj): Item[] {
    const document = obj.textEditor;
    const nodes = getMarkdownTaskNodes(document);
    const byLine = new Map(nodes.map((node) => [node.lineNumber, node]));
    const visible = new Set<number>();
    nodes
      .filter((node) => node.kind === 'todo' && (this.showFinished || node.status === 'box'))
      .forEach((node) => {
        const branch = [node];
        let parent = byLine.get(node.parent);
        while (parent) {
          branch.push(parent);
          parent = byLine.get(parent.parent);
        }
        if (
          !this.filter ||
          matchesFilesViewFilter(
            this.filter,
            obj.filePath,
            branch.map((record) => document.lineAt(record.lineNumber).text)
          )
        ) {
          branch.forEach((record) => visible.add(record.lineNumber));
        }
      });
    return nodes
      .filter((node) => node.parent === obj.markdownParent && visible.has(node.lineNumber))
      .map((node) => {
        const data = {
          ...obj,
          markdownParent: node.lineNumber,
          lineNr: node.lineNumber,
          line: document.lineAt(node.lineNumber),
          documentVersion: document.version,
        };
        const label =
          this.config.file.view.showTags === false ? Tags.removeAll(node.title) : node.title;
        const hasChildren = nodes.some(
          (candidate) => candidate.parent === node.lineNumber && visible.has(candidate.lineNumber)
        );
        const item =
          node.kind === 'project' || hasChildren ? new Group(data, label) : new Todo(data, label);
        item.contextValue = node.kind === 'todo' ? 'todo' : 'group';
        item.description =
          node.kind === 'todo'
            ? node.status === 'done'
              ? '✓'
              : node.status === 'cancelled'
                ? 'Cancelled'
                : ''
            : undefined;
        return item;
      });
  }

  setTreeView(treeView) {
    super.setTreeView(treeView);
    this.refreshActivityBarBadge();
  }

  async refreshActivityBarBadge() {
    if (!supportsActivityBarBadge(this.treeView)) return;

    try {
      await Utils.files.get();
      this.updateActivityBarBadge();
    } catch (error) {
      console.warn('Todo+: Could not update the activity bar badge', error);
    }
  }

  updateActivityBarBadge() {
    if (!supportsActivityBarBadge(this.treeView)) return;

    const filesData = Utils.files.filesData || {};
    const markdownFiles = Object.keys(filesData).filter(
      (filePath) => filesData[filePath] && isMarkdownTaskDocument(filesData[filePath].textEditor)
    );
    const regular = Object.keys(filesData).reduce((result, filePath) => {
      if (!markdownFiles.includes(filePath)) result[filePath] = filesData[filePath];
      return result;
    }, {});
    const pending =
      countPendingTodos(regular, Consts.regexes.todoBox) +
      markdownFiles.reduce(
        (count, filePath) =>
          count +
          getMarkdownTaskNodes(filesData[filePath].textEditor).filter(
            (node) => node.kind === 'todo' && node.status === 'box' && !node.inArchive
          ).length,
        0
      );

    updateActivityBarBadge(this.treeView, pending);
  }

  isFinishedTodo(text: string) {
    return matchesTodoStatus(text, Consts.regexes.todoFinished);
  }

  hasUnfinishedDescendant(textDocument: vscode.TextDocument, lineNr: number) {
    const descendantLines = [],
      startLevel = Utils.ast.getLevel(textDocument, textDocument.lineAt(lineNr).text);

    Utils.ast.walkDown(textDocument, lineNr, true, false, ({ line, level }) => {
      if (level <= startLevel) return false;

      descendantLines.push(line.text);
    });

    return hasUnfinishedTodo(descendantLines, Consts.regexes.todo, Consts.regexes.todoFinished);
  }

  matchesFilter(textEditor: vscode.TextDocument, lineNr: number, filePath: string) {
    if (!this.filter) return true;

    const branchLines = [textEditor.lineAt(lineNr).text],
      startLevel = Utils.ast.getLevel(textEditor, branchLines[0]);

    Utils.ast.walkDown(textEditor, lineNr, true, false, ({ line, level }) => {
      if (level <= startLevel) return false;

      branchLines.push(line.text);
    });

    return matchesFilesViewFilter(this.filter, filePath, branchLines);
  }
}

/* EXPORT */

export default new Files();
