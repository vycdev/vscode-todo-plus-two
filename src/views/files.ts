/* IMPORT */

import * as _ from 'lodash';
import { commands, TreeItemCollapsibleState } from 'vscode';
import type { TextDocument, TextLine, TreeItem } from 'vscode';
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
import { transformMarkdownTaskText } from '../utils/markdown-task-text';
import { getTaskTagNames, groupTasksByTags, normalizeTagGroupNames } from '../utils/tag-groups';

/* FILES */

interface GroupedTask {
  line: TextLine;
  lineNr: number;
  title: string;
  path: string[];
  statusLabel: string;
  tagNames: string[];
}

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

  getTreeItem(item: Item): TreeItem {
    if (item.collapsibleState !== TreeItemCollapsibleState.None) {
      item.collapsibleState = this.expanded
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.Collapsed;
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

    if (Array.isArray(obj)) return obj;

    if (_.isEmpty(obj)) {
      return [
        new Placeholder(this.filter ? 'No matching todo files found' : 'No todo files found'),
      ];
    }

    if (obj.textEditor) {
      const groupNames = normalizeTagGroupNames(this.config.file.view.groupByTags);
      if (groupNames.length && obj.lineNr === undefined)
        return this.getTagGroupedChildren(obj, groupNames);
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

    commands.executeCommand('setContext', 'todo-files-show-finished', this.showFinished);
  }

  private getTagGroupedChildren(
    obj: { textEditor: TextDocument; filePath: string; relativePath?: string },
    groupNames: string[]
  ): Item[] {
    const document = obj.textEditor;
    const markdown = isMarkdownTaskDocument(document);
    const nodes = markdown ? getMarkdownTaskNodes(document) : [];
    const byLine = new Map(nodes.map((node) => [node.lineNumber, node]));
    const ancestors: Array<{ level: number; title: string }> = [];
    const tasks: GroupedTask[] = [];

    for (let lineNr = 0; lineNr < document.lineCount; lineNr++) {
      const line = document.lineAt(lineNr);
      let title = line.text.trimStart();
      let path: string[];
      let finished: boolean;
      let statusLabel = '';
      if (markdown) {
        const node = byLine.get(lineNr);
        if (!node || node.kind !== 'todo') continue;
        title = node.title;
        finished = node.status !== 'box';
        statusLabel = node.status === 'done' ? '✓' : node.status === 'cancelled' ? 'Cancelled' : '';
        path = [];
        let parent = byLine.get(node.parent);
        while (parent) {
          path.unshift(parent.title);
          parent = byLine.get(parent.parent);
        }
      } else {
        if (!line.text.trim()) continue;
        const level = Utils.ast.getLevel(document, line.text);
        while (ancestors.length && ancestors[ancestors.length - 1].level >= level) ancestors.pop();
        path = ancestors.map((parent) => parent.title);
        const isTodo = matchesTodoStatus(line.text, Consts.regexes.todo);
        if (isTodo || matchesTodoStatus(line.text, Consts.regexes.project))
          ancestors.push({ level, title });
        if (!isTodo) continue;
        finished = this.isFinishedTodo(line.text);
      }
      if (!this.showFinished && finished) continue;
      if (!matchesFilesViewFilter(this.filter, obj.filePath, [line.text, ...path])) continue;

      tasks.push({
        line,
        lineNr,
        title,
        path,
        statusLabel,
        tagNames: getTaskTagNames(title, markdown),
      });
    }

    const getLabel = (text: string) =>
      this.config.file.view.showTags === false
        ? markdown
          ? transformMarkdownTaskText(text, Tags.removeAll)
          : Tags.removeAll(text)
        : text;
    const groups = groupTasksByTags(tasks, groupNames).map((group) => {
      const todos = group.tasks.map((task) => {
        const todo = new Todo(
          {
            filePath: obj.filePath,
            textEditor: document,
            line: task.line,
            lineNr: task.lineNr,
            documentVersion: document.version,
          },
          getLabel(task.title)
        );
        const sourcePath = task.path.map(getLabel).join(' / ');
        todo.description = [task.statusLabel, sourcePath].filter(Boolean).join(' · ');
        todo.tooltip = [task.line.text, obj.relativePath || obj.filePath, ...task.path].join('\n');
        return todo;
      });
      return new Group(todos, `${group.name ? `@${group.name}` : 'Other'} (${todos.length})`);
    });

    return groups.length
      ? groups
      : [
          new Placeholder(
            this.filter
              ? 'No matching tasks found'
              : this.showFinished
                ? 'No tasks found'
                : 'No unfinished tasks found'
          ),
        ];
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
          this.config.file.view.showTags === false
            ? transformMarkdownTaskText(node.title, Tags.removeAll)
            : node.title;
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

  hasUnfinishedDescendant(textDocument: TextDocument, lineNr: number) {
    const descendantLines = [],
      startLevel = Utils.ast.getLevel(textDocument, textDocument.lineAt(lineNr).text);

    Utils.ast.walkDown(textDocument, lineNr, true, false, ({ line, level }) => {
      if (level <= startLevel) return false;

      descendantLines.push(line.text);
    });

    return hasUnfinishedTodo(descendantLines, Consts.regexes.todo, Consts.regexes.todoFinished);
  }

  matchesFilter(textEditor: TextDocument, lineNr: number, filePath: string) {
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
