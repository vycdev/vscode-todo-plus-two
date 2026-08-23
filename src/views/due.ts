import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../config';
import Consts from '../consts';
import Utils from '../utils';
import { getDueDateKey, getDueTaskLines } from '../utils/due_tasks';
import Group from './items/group';
import Item from './items/item';
import Placeholder from './items/placeholder';
import Todo from './items/todo';
import View from './view';

class DueView extends View {
    id = 'todo.views.3due';
    rolloverTimer;

    constructor() {
        super();
        this.scheduleRolloverRefresh();
    }

    scheduleRolloverRefresh() {
        const now = new Date(),
            tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
            delay = tomorrow.getTime() - now.getTime() + 1000;

        clearTimeout(this.rolloverTimer);
        this.rolloverTimer = setTimeout(() => {
            this.refresh();
            this.scheduleRolloverRefresh();
        }, delay);
    }

    async getChildren(item?: Item): Promise<Item[]> {
        if (item) return item.obj;

        await Utils.files.get();

        const filesData = Utils.files.filesData || {},
            groups = {},
            today = new Date(),
            todayKey = getDueDateKey(today),
            soonDays = Number(Config.getKey('due.soonDays')) || 7;

        Object.keys(filesData).forEach((filePath) => {
            const data = filesData[filePath];

            if (!data || !data.textEditor) return;

            const lines = [];

            for (let lineNumber = 0; lineNumber < data.textEditor.lineCount; lineNumber++) {
                lines.push(data.textEditor.lineAt(lineNumber).text);
            }

            getDueTaskLines(
                lines,
                Consts.regexes.todo,
                Consts.regexes.todoFinished,
                today,
                soonDays
            ).forEach((task) => {
                const line = data.textEditor.lineAt(task.lineNumber),
                    obj = {
                        filePath,
                        line,
                        lineNr: task.lineNumber,
                        relativePath: data.relativePath,
                        textEditor: data.textEditor,
                    },
                    todo = new Todo(obj, _.trimStart(task.text));

                todo.tooltip = `${task.text}\n${data.relativePath}`;

                if (!groups[task.dateKey]) groups[task.dateKey] = { date: task.date, todos: [] };
                groups[task.dateKey].todos.push(todo);
            });
        });

        const dateKeys = Object.keys(groups).sort();

        if (!dateKeys.length) return [new Placeholder('No unfinished tasks with due dates found')];

        return dateKeys.map((dateKey) => {
            const groupData = groups[dateKey],
                label =
                    dateKey === todayKey
                        ? 'Today'
                        : groupData.date.toLocaleDateString(undefined, {
                              weekday: 'short',
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                          }),
                group = new Group(groupData.todos, `${label} (${groupData.todos.length})`);
            group.collapsibleState =
                dateKey === todayKey
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;

            return group;
        });
    }
}

export const Due = new DueView();
