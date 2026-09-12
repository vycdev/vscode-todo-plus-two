/* IMPORT */

import * as vscode from 'vscode';
import Config from '../config';
import Item from './items/item';

/* VIEW */

class View implements vscode.TreeDataProvider<Item> {
    config;
    treeView;
    onDidChangeTreeDataEvent = new vscode.EventEmitter<Item | undefined>();
    onDidChangeTreeData = this.onDidChangeTreeDataEvent.event;

    constructor() {
        this.config = Config.get();
    }

    getTreeItem(item: Item): vscode.TreeItem {
        return item;
    }

    async getChildren(item?: Item): Promise<Item[]> {
        return [];
    }

    setTreeView(treeView) {
        this.treeView = treeView;
    }

    refresh() {
        this.config = Config.get();

        this.onDidChangeTreeDataEvent.fire();
    }
}

/* EXPORT */

export default View;
