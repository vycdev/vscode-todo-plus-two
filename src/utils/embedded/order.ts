import type { Memento } from 'vscode';
import { getFilePathKey } from '../file-globs';

const storageKey = 'todo.embedded.manualOrder.v1';

interface EmbeddedTodoIdentity {
  filePath: string;
  type: string;
  todo: string;
}

// Line numbers and display settings are deliberately excluded: inserting source
// lines or showing context must not change the identity of an unchanged comment.
export const getEmbeddedTodoKeys = (todos: EmbeddedTodoIdentity[]): string[] => {
  const occurrences = new Map<string, number>();

  return todos.map((todo) => {
    const identity = JSON.stringify([getFilePathKey(todo.filePath), todo.type, todo.todo]),
      occurrence = occurrences.get(identity) || 0;

    occurrences.set(identity, occurrence + 1);
    return JSON.stringify([identity, occurrence]);
  });
};

export const createEmbeddedOrder = (storage: Pick<Memento, 'get' | 'update'>) => {
  const saved = storage.get<unknown>(storageKey);
  let orders = new Map<string, string[]>();

  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    Object.keys(saved).forEach((scope) => {
      const keys = saved[scope];
      if (Array.isArray(keys) && keys.every((key) => typeof key === 'string')) {
        orders.set(scope, Array.from(new Set<string>(keys)));
      }
    });
  }

  const apply = (scope: string, keys: string[]): string[] => {
    const present = new Set(keys),
      savedKeys = orders.get(scope) || [],
      ranked = new Set(savedKeys);

    return savedKeys
      .filter((key) => present.has(key))
      .concat(keys.filter((key) => !ranked.has(key)));
  };

  const save = async (next: Map<string, string[]>): Promise<void> => {
    const value: { [scope: string]: string[] } = Object.create(null);
    next.forEach((keys, scope) => (value[scope] = keys));
    await storage.update(storageKey, value);
    orders = next;
  };

  const moveTo = async (
    scope: string,
    keys: string[],
    key: string,
    targetKey: string
  ): Promise<boolean> => {
    const ordered = apply(scope, keys),
      index = ordered.indexOf(key),
      target = ordered.indexOf(targetKey);

    if (index < 0 || target < 0 || index === target) return false;

    // Use the target's original index: upward moves land before it, downward
    // moves land after it. This also allows dropping onto the last sibling.
    ordered.splice(index, 1);
    ordered.splice(target, 0, key);

    // Keep absent entries in their saved slots so temporary exclusions do not
    // discard their ranks when the remaining siblings are reordered.
    const present = new Set(keys);
    let cursor = 0;
    const merged = (orders.get(scope) || []).map((savedKey) =>
      present.has(savedKey) ? ordered[cursor++] : savedKey
    );
    merged.push(...ordered.slice(cursor));

    const next = new Map(orders);
    next.set(scope, merged);
    await save(next);
    return true;
  };

  const move = (
    scope: string,
    keys: string[],
    key: string,
    direction: -1 | 1
  ): Promise<boolean> => {
    const ordered = apply(scope, keys),
      index = ordered.indexOf(key),
      target = ordered[index + direction];

    if (index < 0 || target === undefined) return Promise.resolve(false);
    return moveTo(scope, keys, key, target);
  };

  return { apply, move, moveTo, reset: () => save(new Map()) };
};
