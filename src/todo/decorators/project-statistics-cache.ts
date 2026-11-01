import type { ChangedLines } from './document-lines-cache';
import type Tokens from '../../utils/statistics_tokens';

interface ProjectLine {
  lineNumber: number;
  level: number;
  dynamic: boolean;
  items: {
    archive?: any;
    projects: any[];
    comments: any[];
    todosBox: any[];
    todosDone: any[];
    todosCancelled: any[];
  };
}

interface Scope<T> {
  line: T;
  start: number;
  end: number;
  boundary?: T;
  archive: boolean;
}

const getScopes = <T extends ProjectLine>(lines: T[]) => {
  const scopes = new Map<T, Scope<T>>(),
    stack: Scope<T>[] = [];
  const archive = lines.find((line) => line.items.archive);
  for (const line of lines) {
    const items = line.items;
    if (!(
      items.projects.length ||
      items.comments.length ||
      items.todosBox.length ||
      items.todosDone.length ||
      items.todosCancelled.length
    ))
      continue;
    while (stack.length && stack[stack.length - 1].line.level >= line.level) {
      const scope = stack.pop();
      scope.end = line.lineNumber;
      scope.boundary = line;
    }
    if (items.projects.length) {
      const scope = { line, start: line.lineNumber, end: lines.length, archive: line === archive };
      scopes.set(line, scope);
      if (!scope.archive) stack.push(scope);
    }
  }
  return scopes;
};

const intersects = <T>(scope: Scope<T>, changes: ChangedLines[]) =>
  changes.some(({ start, end }) => end >= scope.start && start < scope.end);

export class ProjectStatisticsCache<T extends ProjectLine> {
  private scopes = new Map<T, Scope<T>>();
  private tokens = new Map<T, Tokens>();

  prepare(lines: T[], previousChanges: ChangedLines[], nextChanges: ChangedLines[]) {
    const scopes = getScopes(lines),
      reusable = new Map<any, Tokens>(),
      dynamic = [0];
    lines.forEach((line, index) => dynamic.push(dynamic[index] + Number(line.dynamic)));
    for (const [line, scope] of scopes) {
      const previous = this.scopes.get(line);
      if (
        previous &&
        previous.boundary === scope.boundary &&
        previous.archive === scope.archive &&
        !intersects(previous, previousChanges) &&
        !intersects(scope, nextChanges) &&
        dynamic[scope.end] === dynamic[scope.start] &&
        this.tokens.has(line)
      ) {
        reusable.set(line.items.projects[0], this.tokens.get(line));
      }
    }
    return { scopes, reusable };
  }

  store(scopes: Map<T, Scope<T>>, tokens: Record<number, Tokens>) {
    this.scopes = scopes;
    this.tokens = new Map([...scopes.keys()].map((line) => [line, tokens[line.lineNumber]]));
  }
}
