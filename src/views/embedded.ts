/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import type { CancellationToken, Memento } from 'vscode';
import Utils from '../utils';
import { getFilePathKey } from '../utils/file-globs';
import { createEmbeddedOrder, getEmbeddedTodoKeys } from '../utils/embedded/order';
import { enqueueEmbeddedRefresh } from '../utils/embedded/provider-lifecycle';
import File from './items/file';
import Item from './items/item';
import Group from './items/group';
import Placeholder from './items/placeholder';
import Todo from './items/todo';
import View from './view';

/* EMBEDDED */

//TODO: Collapse/Expand without rebuilding the tree https://github.com/Microsoft/vscode/issues/54192

// Levels follow the provider's root -> type -> file -> todo hierarchy, including
// empty-key groups that are hidden in the tree.
interface NodeOrder {
  scope: string;
  key: string;
  parent?: Item;
  path: string[];
  level: number;
  generation: number;
}

class Embedded extends View {
  id = 'todo.views.2embedded';
  all = true;
  clear = false;
  expanded = true;
  filter: string | false = false;
  filePathRe = /^(?!~).*(?:\\|\/)/;
  private fileItems: Map<string, Item> = new Map();
  private refreshFileQueue = { current: Promise.resolve() };
  private orderQueue = { current: Promise.resolve() };
  private order: ReturnType<typeof createEmbeddedOrder>;
  private nodeOrder = new WeakMap<Item, NodeOrder>();
  private generation = 0;

  constructor() {
    super();

    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        if (this.all) return;
        this.refresh();
      })
    );
  }

  initializeOrder(storage: Memento) {
    this.order = createEmbeddedOrder(storage);
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
      this.deferRefresh();

      return [];
    }

    // If we're rebuilding from root, clear the fileItems map; it will be repopulated as nodes are created
    if (!item) this.fileItems.clear();

    const parentOrder = item && this.nodeOrder.get(item);
    let obj = item ? item.obj : await this.getEmbedded(),
      level = parentOrder ? parentOrder.level + 1 : 0,
      path = parentOrder ? parentOrder.path : [];

    while (obj && !_.isArray(obj) && '' in obj) {
      path = this.getOrderPath(path, level++, '', obj['']);
      obj = obj['']; // Collapsing unnecessary groups
    }

    if (_.isEmpty(obj)) return [new Placeholder('No embedded todos found')];

    if (_.isArray(obj)) {
      if (this.config.embedded.view.sort === 'manual') {
        obj = obj
          .slice()
          .sort(
            (a, b) =>
              getFilePathKey(a.filePath).localeCompare(getFilePathKey(b.filePath)) ||
              a.lineNr - b.lineNr ||
              a.column - b.column
          );
      }
      const todos = obj.map((obj) => {
        const label = this.config.embedded.view.wholeLine ? obj.line : obj.message || obj.todo;

        return new Todo(
          obj,
          this.config.embedded.view.showContext && obj.context
            ? `${label} — ${obj.context}`
            : label,
          this.config.embedded.view.icons
        );
      });

      if (this.config.embedded.view.sort === 'label') {
        todos.sort((a, b) => {
          return a.label.toString().localeCompare(b.label.toString());
        });
      }

      return this.config.embedded.view.sort === 'manual'
        ? this.orderItems(todos, getEmbeddedTodoKeys(obj), item, path, level)
        : todos;
    } else if (_.isObject(obj)) {
      const keys = Object.keys(obj).sort();

      const items = keys.map((key) => {
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
      return this.config.embedded.view.sort === 'manual'
        ? this.orderItems(items, keys, item, path, level)
        : items;
    }
  }

  private getOrderPath(path: string[], level: number, key: string, obj): string[] {
    // The provider hides a single workspace-root group. Use its actual path so
    // adding another root does not discard the existing root's child ordering.
    if (level === 0 && this.config.embedded.view.groupByRoot) {
      let data = obj;
      while (data && !_.isArray(data)) data = data[Object.keys(data)[0]];
      if (data && data[0] && data[0].rootPath) key = getFilePathKey(data[0].rootPath);
    } else if (level === 2 && key) {
      key = getFilePathKey(key);
    }
    return path.concat(JSON.stringify([level, key]));
  }

  private orderItems(
    items: Item[],
    keys: string[],
    parent: Item | undefined,
    path: string[],
    level: number
  ): Item[] {
    const scope = JSON.stringify([level, path]),
      byKey = new Map<string, Item>();

    items.forEach((item, index) => {
      const nodePath = this.getOrderPath(path, level, keys[index], item.obj),
        key = nodePath[nodePath.length - 1];
      byKey.set(key, item);
      this.nodeOrder.set(item, {
        scope,
        key,
        parent,
        level,
        generation: this.generation,
        path: nodePath,
      });
      item.id = JSON.stringify([scope, key]);
    });

    if (!this.order) return items;
    return this.order.apply(scope, Array.from(byKey.keys())).map((key) => byKey.get(key));
  }

  move(item: Item, direction: -1 | 1): Promise<void> {
    return enqueueEmbeddedRefresh(this.orderQueue, async () => {
      const info = item && this.nodeOrder.get(item);
      if (!this.canMove() || !info || info.generation !== this.generation) return;

      const siblings = await this.getChildren(info.parent);
      if (!this.canMove() || info.generation !== this.generation) return;

      const keys = siblings
        .map((sibling) => this.nodeOrder.get(sibling))
        .filter((sibling) => sibling && sibling.scope === info.scope)
        .map((sibling) => sibling.key);
      if (await this.order.move(info.scope, keys, info.key, direction)) this.refresh();
    });
  }

  private canMove(): boolean {
    return !!this.order && this.config.embedded.view.sort === 'manual' && !this.filter && this.all;
  }

  canDrag(item: Item): boolean {
    const info = item && this.nodeOrder.get(item);
    return this.canMove() && !!info && info.generation === this.generation;
  }

  drop(item: Item, target: Item, token: CancellationToken): Promise<void> {
    return enqueueEmbeddedRefresh(this.orderQueue, async () => {
      if (token.isCancellationRequested || !this.canDrag(item) || !this.canDrag(target)) return;

      const sourceInfo = this.nodeOrder.get(item),
        targetInfo = this.nodeOrder.get(target);
      if (sourceInfo.scope !== targetInfo.scope || sourceInfo.key === targetInfo.key) return;

      const siblings = await this.getChildren(sourceInfo.parent);
      if (token.isCancellationRequested || !this.canDrag(item) || !this.canDrag(target)) return;

      const keys = siblings
        .map((sibling) => this.nodeOrder.get(sibling))
        .filter((sibling) => sibling && sibling.scope === sourceInfo.scope)
        .map((sibling) => sibling.key);
      if (await this.order.moveTo(sourceInfo.scope, keys, sourceInfo.key, targetInfo.key)) {
        this.refresh();
      }
    });
  }

  resetOrder(): Promise<void> {
    return enqueueEmbeddedRefresh(this.orderQueue, async () => {
      if (!this.order) return;
      await this.order.reset();
      this.refresh();
    });
  }

  refresh(clear?) {
    this.clear = !!clear;
    this.generation++;

    super.refresh();
  }

  refreshFile(filePath: string) {
    return enqueueEmbeddedRefresh(this.refreshFileQueue, () => this.refreshFileNow(filePath));
  }

  private async refreshFileNow(filePath: string) {
    try {
      await Utils.embedded.initProvider();

      // Ensure file data is up to date if it's pending
      const provider = Utils.embedded.provider as any;
      const cachedFilePath =
        provider && typeof provider.getCachedFilePath === 'function'
          ? provider.getCachedFilePath(filePath)
          : filePath;

      if (provider && provider.filesData && provider.filesData[cachedFilePath] === undefined) {
        await provider.get();
      }

      // Filtering and grouping can change every ancestor and can show a file more than once.
      if (this.filter || this.config.embedded.view.groupByType || !this.all) {
        this.refresh();
        return;
      }

      // Try both slash variants for mapping
      const keysToTry = [
        cachedFilePath,
        cachedFilePath.replace(/\\/g, '/'),
        filePath,
        filePath.replace(/\\/g, '/'),
      ];
      let item: Item | undefined;
      for (const k of keysToTry) {
        item = this.fileItems.get(k);
        if (item) break;
      }

      if (item) {
        // Update the node's backing data from the provider so children reflect new content
        const fresh =
          provider && provider.filesData ? provider.filesData[cachedFilePath] : undefined;
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
