/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Utils from '../utils';
import Consts from '../consts';
import Config from '../config';
import { matchesFilesViewFilter } from '../utils/files-view-filter';
import File from './items/file';
import Item from './items/item';
import Group from './items/group';
import Placeholder from './items/placeholder';
import Todo from './items/todo';
import View from './view';

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
            setTimeout(this.refresh.bind(this), 0);

            return [];
        }

        let obj = item ? item.obj : await Utils.files.get(undefined, this.filter);

        while (obj && '' in obj) obj = obj['']; // Collapsing unnecessary groups

        if (_.isEmpty(obj)) {
            return [
                new Placeholder(
                    this.filter ? 'No matching todo files found' : 'No todo files found'
                ),
            ];
        }

        if (obj.textEditor) {
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

                // Respect comment visibility setting for Todo files
                const showComments = !!Config.getKey('embedded.showComments');
                const isCommentLine = !!(
                    Consts &&
                    Consts.regexes &&
                    data.line &&
                    data.line.text &&
                    data.line.text.match(Consts.regexes.comment)
                );
                if (!showComments && isCommentLine) return;
                if (!this.showFinished && this.isFinishedTodo(data.line.text)) return;
                if (!this.matchesFilter(obj.textEditor, data.line.lineNumber, obj.filePath)) return;

                const label = _.trimStart(data.line.text),
                    item = isGroup ? new Group(data, label) : new Todo(data, label);

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
                    return new Group(val, key, this.config.embedded.view.icons);
                }
            });
        }
    }

    refresh(clear?) {
        this.clear = !!clear;

        super.refresh();

        vscode.commands.executeCommand('setContext', 'todo-files-show-finished', this.showFinished);
    }

    isFinishedTodo(text: string) {
        return !!text.match(Consts.regexes.todoFinished);
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
