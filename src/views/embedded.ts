/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Utils from '../utils';
import File from './items/file';
import Item from './items/item';
import Group from './items/group';
import Placeholder from './items/placeholder';
import Todo from './items/todo';
import View from './view';

/* EMBEDDED */

//TODO: Collapse/Expand without rebuilding the tree https://github.com/Microsoft/vscode/issues/54192

class Embedded extends View {
    id = 'todo.views.2embedded';
    all = true;
    clear = false;
    expanded = true;
    filter: string | false = false;
    filePathRe = /^(?!~).*(?:\\|\/)/;
    private fileItems: Map<string, Item> = new Map();

    constructor() {
        super();

        vscode.window.onDidChangeActiveTextEditor(() => {
            if (this.all) return;
            this.refresh();
        });
    }

    getTreeItem(item: Item): vscode.TreeItem {
        if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            item.collapsibleState = this.expanded
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
        }

        return item;
    }

    async getEmbedded() {
        await Utils.embedded.initProvider();

        return await Utils.embedded.provider.get(
            undefined,
            this.config.embedded.view.groupByRoot,
            this.config.embedded.view.groupByType,
            this.config.embedded.view.groupByFile,
            this.filter,
            !this.all
        );
    }

    async getChildren(item?: Item): Promise<Item[]> {
        if (this.clear) {
            setTimeout(this.refresh.bind(this), 0);

            return [];
        }

        // If we're rebuilding from root, clear the fileItems map; it will be repopulated as nodes are created
        if (!item) this.fileItems.clear();

        let obj = item ? item.obj : await this.getEmbedded();

        while (obj && '' in obj) obj = obj['']; // Collapsing unnecessary groups

        if (_.isEmpty(obj)) return [new Placeholder('No embedded todos found')];

        if (_.isArray(obj)) {
            const todos = obj.map((obj) => {
                return new Todo(
                    obj,
                    this.config.embedded.view.wholeLine ? obj.line : obj.message || obj.todo,
                    this.config.embedded.view.icons
                );
            });

            if (this.config.embedded.view.sortBy === 'label') {
                todos.sort((a, b) => {
                    return a.label.toString().localeCompare(b.label.toString());
                });
            }

            return todos;
        } else if (_.isObject(obj)) {
            const keys = Object.keys(obj).sort();

            return keys.map((key) => {
                const val = obj[key];

                if (this.filePathRe.test(key)) {
                    const uri = Utils.view.getURI(val[0]);
                    const fileItem = new File(val, uri);
                    // Store mapping to allow per-file refresh; accept both slash variants on Windows
                    this.fileItems.set(key, fileItem);
                    this.fileItems.set(key.replace(/\\/g, '/'), fileItem);
                    return fileItem;
                } else {
                    return new Group(val, key, this.config.embedded.view.icons);
                }
            });
        }
    }

    refresh(clear?) {
        this.clear = !!clear;

        super.refresh();
    }

    async refreshFile(filePath: string) {
        try {
            await Utils.embedded.initProvider();

            // Ensure file data is up to date if it's pending
            const provider = Utils.embedded.provider as any;
            if (provider && provider.filesData && provider.filesData[filePath] === undefined) {
                await provider.updateFilesData();
            }

            // Try both slash variants for mapping
            const keysToTry = [filePath, filePath.replace(/\\/g, '/')];
            let item: Item | undefined;
            for (const k of keysToTry) {
                item = this.fileItems.get(k);
                if (item) break;
            }

            if (item) {
                // Update the node's backing data from the provider so children reflect new content
                const fresh =
                    provider && provider.filesData ? provider.filesData[filePath] : undefined;
                if (fresh && fresh.length) {
                    item.obj = fresh;
                    this.onDidChangeTreeDataEvent.fire(item);
                } else {
                    // File no longer has todos; fall back to a full refresh to drop the node
                    this.refresh();
                }
            } else {
                // No mapping (node may not be visible or grouping differs); full refresh
                this.refresh();
            }
        } catch (e) {
            this.refresh();
        }
    }
}

/* EXPORT */

export default new Embedded();
