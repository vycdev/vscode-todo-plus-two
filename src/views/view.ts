/* IMPORT */

import * as vscode from 'vscode';
import Config from '../config';
import Item from './items/item';

/* VIEW */

class View implements vscode.TreeDataProvider<Item> {
  protected subscriptions: vscode.Disposable[] = [];
  private refreshTimer;
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

  protected deferRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 0);
  }

  dispose() {
    clearTimeout(this.refreshTimer);
    this.treeView = undefined;
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.subscriptions = [];
    this.onDidChangeTreeDataEvent.dispose();
  }
}

/* EXPORT */

export default View;
