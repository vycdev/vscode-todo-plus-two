export interface UnarchiveOptions {
    indentation?: string;
    isFinishedTodo: (line: string) => boolean;
    isComment: (line: string) => boolean;
    getProjectName: (line: string) => string | undefined;
}

export interface UnarchiveResult {
    content: string;
    count: number;
}

interface ProjectRecord {
    names: string[];
    level: number;
    start: number;
}

interface UnarchiveBlock {
    lines: string[];
    projectNames: string[];
    todoLevel: number;
}

const defaultIndentation = '  ';

function getLineLevel(line: string, indentation: string) {
    const match = line.match(/^\s*/);
    const whitespace = match ? match[0] : '';

    if (!whitespace || !indentation) return 0;

    if (indentation === '\t') return whitespace.split('\t').length - 1;

    return Math.floor(whitespace.length / indentation.length);
}

function getTrailingEmptyStart(lines: string[]) {
    let index = lines.length;

    while (index > 0 && lines[index - 1].trim() === '') index--;

    return index;
}

function areEqual(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getProjectRecords(lines: string[], options: UnarchiveOptions, indentation: string) {
    const records: ProjectRecord[] = [];
    const stack: ProjectRecord[] = [];

    lines.forEach((line, start) => {
        if (!line.trim()) return;

        const level = getLineLevel(line, indentation);

        while (stack.length && level <= stack[stack.length - 1].level) stack.pop();

        const name = options.getProjectName(line);

        if (!name) return;

        const record = {
            names: stack.map((project) => project.names[project.names.length - 1]).concat(name),
            level,
            start,
        };

        stack.push(record);
        records.push(record);
    });

    return records;
}

function getProjectNamesAtLine(
    lines: string[],
    archiveLine: number,
    todoLine: number,
    options: UnarchiveOptions,
    indentation: string
) {
    const archiveLevel = getLineLevel(lines[archiveLine], indentation);
    const stack: Array<{ name: string; level: number }> = [];

    for (let index = archiveLine + 1; index < todoLine; index++) {
        const line = lines[index];

        if (!line.trim()) continue;

        const level = getLineLevel(line, indentation);

        if (level <= archiveLevel) {
            stack.length = 0;
            continue;
        }

        while (stack.length && level <= stack[stack.length - 1].level) stack.pop();

        const name = options.getProjectName(line);

        if (name) stack.push({ name, level });
    }

    return stack.map((project) => project.name);
}

function getProjectEnd(
    lines: string[],
    project: ProjectRecord,
    options: UnarchiveOptions,
    indentation: string
) {
    for (let index = project.start + 1; index < lines.length; index++) {
        const line = lines[index];

        if (!line.trim()) continue;

        if (getLineLevel(line, indentation) <= project.level) return index;
    }

    return lines.length;
}

function findProject(
    lines: string[],
    projectNames: string[],
    options: UnarchiveOptions,
    indentation: string
) {
    return getProjectRecords(lines, options, indentation).find((project) =>
        areEqual(project.names, projectNames)
    );
}

function ensureProjectChain(
    lines: string[],
    projectNames: string[],
    rootLevel: number,
    options: UnarchiveOptions,
    indentation: string
) {
    let target = findProject(lines, projectNames, options, indentation);

    if (target) return target;

    const records = getProjectRecords(lines, options, indentation);
    let parent: ProjectRecord | undefined;
    let matchedLength = 0;

    for (let length = projectNames.length - 1; length > 0; length--) {
        parent = records.find((project) => areEqual(project.names, projectNames.slice(0, length)));

        if (parent) {
            matchedLength = length;
            break;
        }
    }

    let insertAt = getTrailingEmptyStart(lines);
    let level = rootLevel;

    if (parent) {
        insertAt = Math.min(
            getProjectEnd(lines, parent, options, indentation),
            getTrailingEmptyStart(lines)
        );
        level = parent.level + 1;
    }

    for (let index = matchedLength; index < projectNames.length; index++) {
        lines.splice(insertAt, 0, `${indentation.repeat(level)}${projectNames[index]}:`);
        insertAt++;
        level++;
    }

    target = findProject(lines, projectNames, options, indentation);

    return target;
}

function getUnarchiveBlock(
    lines: string[],
    archiveLine: number,
    todoLine: number,
    options: UnarchiveOptions,
    indentation: string
) {
    if (!options.isFinishedTodo(lines[todoLine])) return;

    const todoLevel = getLineLevel(lines[todoLine], indentation);
    const blockLines = [lines[todoLine]];
    const pendingEmptyLines: string[] = [];

    for (let index = todoLine + 1; index < lines.length; index++) {
        const line = lines[index];

        if (!line.trim()) {
            pendingEmptyLines.push(line);
            continue;
        }

        if (!options.isComment(line) || getLineLevel(line, indentation) < todoLevel) break;

        blockLines.push(...pendingEmptyLines, line);
        pendingEmptyLines.length = 0;
    }

    const block: UnarchiveBlock = {
        lines: blockLines,
        projectNames: getProjectNamesAtLine(lines, archiveLine, todoLine, options, indentation),
        todoLevel,
    };

    return block;
}

function normalizeBlock(
    lines: string[],
    todoLevel: number,
    targetLevel: number,
    indentation: string
) {
    return lines.map((line) => {
        if (!line.trim()) return '';

        const relativeLevel = Math.max(0, getLineLevel(line, indentation) - todoLevel);

        return `${indentation.repeat(targetLevel + relativeLevel)}${line.replace(/^\s*/, '')}`;
    });
}

/**
 * Restores selected finished todo lines from a same-file Archive section. The
 * helper is deliberately independent of VS Code so its structural behavior can
 * be tested without an Extension Host.
 */
export function unarchiveItemsFromSameFileContent(
    content: string,
    selectedLineNumbers: number[],
    archiveLine: number,
    options: UnarchiveOptions
): UnarchiveResult {
    const eol = content.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    const lines = content.split(eol);
    const indentation = options.indentation || defaultIndentation;
    const selected = Array.from(new Set(selectedLineNumbers))
        .filter((lineNumber) => lineNumber > archiveLine && lineNumber < lines.length)
        .sort((left, right) => left - right);
    const blocks: Array<{ start: number; end: number; block: UnarchiveBlock }> = [];

    selected.forEach((todoLine) => {
        const block = getUnarchiveBlock(lines, archiveLine, todoLine, options, indentation);

        if (!block) return;

        blocks.push({
            start: todoLine,
            end: todoLine + block.lines.length,
            block,
        });
    });

    if (!blocks.length) return { content, count: 0 };

    const mainLines = lines.slice(0, archiveLine);
    const archiveLevel = getLineLevel(lines[archiveLine], indentation);

    blocks.forEach(({ block }) => {
        let insertAt = getTrailingEmptyStart(mainLines);
        let targetLevel = archiveLevel;

        if (block.projectNames.length) {
            const target = ensureProjectChain(
                mainLines,
                block.projectNames,
                archiveLevel,
                options,
                indentation
            );

            if (target) {
                insertAt = Math.min(
                    getProjectEnd(mainLines, target, options, indentation),
                    getTrailingEmptyStart(mainLines)
                );
                targetLevel = target.level + 1;
            }
        }

        mainLines.splice(
            insertAt,
            0,
            ...normalizeBlock(block.lines, block.todoLevel, targetLevel, indentation)
        );
    });

    const removedLineNumbers = new Set<number>();

    blocks.forEach(({ start, end }) => {
        for (let lineNumber = start; lineNumber < end; lineNumber++) {
            removedLineNumbers.add(lineNumber);
        }
    });

    return {
        content: mainLines
            .concat(
                lines
                    .slice(archiveLine)
                    .filter((_line, index) => !removedLineNumbers.has(archiveLine + index))
            )
            .join(eol),
        count: blocks.length,
    };
}
