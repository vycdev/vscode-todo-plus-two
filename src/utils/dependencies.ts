/* DEPENDENCIES */

export interface DependencyReference {
    id: string;
    start: number;
    end: number;
    tagStart: number;
    tagEnd: number;
}

export interface DependencyTarget extends DependencyReference {
    filePath: string;
    lineNumber: number;
    text: string;
}

export interface DependencyTodoStatus {
    isDone(): boolean;
    isCancelled(): boolean;
    isFinished(): boolean;
}

function getInlineCodeRanges(text: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];

    for (let start = 0; start < text.length; start++) {
        if (text[start] !== '`' || (start > 0 && text[start - 1] === '`')) continue;

        let openingEnd = start + 1;
        while (openingEnd < text.length && text[openingEnd] === '`') openingEnd++;

        const runLength = openingEnd - start;

        for (let cursor = openingEnd; cursor < text.length; cursor++) {
            if (text[cursor] !== '`' || (cursor > 0 && text[cursor - 1] === '`')) continue;

            let closingEnd = cursor + 1;
            while (closingEnd < text.length && text[closingEnd] === '`') closingEnd++;

            if (closingEnd - cursor !== runLength) continue;

            ranges.push({ start, end: closingEnd });
            start = closingEnd - 1;
            break;
        }
    }

    return ranges;
}

function getReferences(text: string, tag: string): DependencyReference[] {
    const regex = new RegExp(`@${tag}\\(([^\\r\\n)]*)\\)`, 'g');
    const inlineCodeRanges = getInlineCodeRanges(text);
    const references: DependencyReference[] = [];
    let match: RegExpExecArray;

    while ((match = regex.exec(text))) {
        if (match.index > 0 && /[a-zA-Z0-9`]/.test(text[match.index - 1])) continue;
        if (
            inlineCodeRanges.some((range) => match.index > range.start && match.index < range.end)
        ) {
            continue;
        }

        const rawId = match[1];
        const id = normalizeId(rawId);

        // Empty tags are harmless text, but cannot identify or reference a task.
        if (!id) continue;

        const valueStart = match.index + tag.length + 2;

        references.push({
            id,
            start: valueStart,
            end: valueStart + rawId.length,
            tagStart: match.index,
            tagEnd: match.index + match[0].length,
        });
    }

    return references;
}

function normalizeId(id: string) {
    return id.trim();
}

function isValidId(id: string) {
    return !!normalizeId(id) && !/[\r\n)]/.test(id);
}

function getUnresolvedIds(
    dependencies: DependencyReference[],
    targets: { [id: string]: DependencyTarget[] },
    isFinished: (target: DependencyTarget) => boolean
) {
    const ids: string[] = [];

    dependencies.forEach((dependency) => {
        const matches = targets[dependency.id] || [];

        if (
            (!matches.length || matches.some((target) => !isFinished(target))) &&
            !ids.includes(dependency.id)
        ) {
            ids.push(dependency.id);
        }
    });

    return ids;
}

function willFinishTodo(todo: DependencyTodoStatus, method: string) {
    if (method === 'toggleDone') return !todo.isDone();
    if (method === 'toggleCancelled') return !todo.isCancelled();

    return !todo.isFinished();
}

function getIds(text: string) {
    return getReferences(text, 'id');
}

function getDependencies(text: string) {
    return getReferences(text, 'depends');
}

/* EXPORT */

export { getIds, getDependencies, normalizeId, isValidId, getUnresolvedIds, willFinishTodo };
