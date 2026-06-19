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

function getReferences(text: string, tag: string): DependencyReference[] {
    const regex = new RegExp(`@${tag}\\(([^\\r\\n)]*)\\)`, 'g');
    const references: DependencyReference[] = [];
    let match: RegExpExecArray;

    while ((match = regex.exec(text))) {
        const id = normalizeId(match[1]);

        // Empty tags are harmless text, but cannot identify or reference a task.
        if (!id) continue;

        const valueStart = match.index + tag.length + 2;

        references.push({
            id,
            start: valueStart,
            end: valueStart + match[1].length,
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

function getIds(text: string) {
    return getReferences(text, 'id');
}

function getDependencies(text: string) {
    return getReferences(text, 'depends');
}

/* EXPORT */

export { getIds, getDependencies, normalizeId, isValidId, getUnresolvedIds };
