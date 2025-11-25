// Do not import Consts or Config since they require the VSCode API. Keep the
// helper pure so tests can import it.
// Match project header lines only, not lines that happen to contain a colon
// such as timestamps in todo tags. Ensure colon is followed by whitespace, end
// of line, or an @ tag (like @done).
const projectParts = /^(\s*)([^:]+):(?=\s|$|@)/;
const defaultIndentUnit = '  ';

export function mergeInsertItemsIntoArchiveContent(
    content: string,
    insertItems: any[],
    config: any
) {
    const projectTagRegex = /\s*@project\([^)]*\)/g;
    const rootIndentLevel =
        config && typeof config.rootIndentLevel === 'number' ? config.rootIndentLevel : 0;
    // Strip project tags from existing content to avoid clutter and duplicate information
    content = (content || '').replace(projectTagRegex, '');
    let lines = content.split('\n');

    // Remove leading and trailing empty lines to avoid creating an extra blank
    // line when merging into empty files or appending to files that have a
    // trailing newline.
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    const indentUnit = (config && config.indentation) || defaultIndentUnit;

    function getIndentLevel(line: string, unit: string) {
        let count = 0;
        if (!unit || !unit.length) return 0;
        while (line.startsWith(unit.repeat(count + 1))) count++;
        return count;
    }

    function detectContentIndentUnit(linesArr: string[]) {
        const wsLens = linesArr
            .map((l) => {
                const m = l.match(/^(\s+)/);
                return m ? m[1] : '';
            })
            .filter(Boolean);

        if (!wsLens.length) return null;

        if (wsLens.find((ws) => ws.indexOf('\t') !== -1)) return '\t';

        const minLen = Math.min(...wsLens.map((ws) => ws.length));
        return ' '.repeat(minLen);
    }

    function trimEmptyEdges(block: string[]) {
        const trimmed = block.slice();
        while (trimmed.length && !trimmed[0].trim()) trimmed.shift();
        while (trimmed.length && !trimmed[trimmed.length - 1].trim()) trimmed.pop();
        return trimmed;
    }

    function insertIntoRoot(block: string[]) {
        const normalized = trimEmptyEdges(block);
        if (!normalized.length) return;

        // Root entries should appear before everything else (prepending behavior).
        // Skip leading blank lines so we don't insert before the opening newline block.
        let insertAt = 0;
        while (insertAt < lines.length && !lines[insertAt].trim()) insertAt++;
        lines.splice(insertAt, 0, ...normalized);
    }

    function parseProjects(linesArr: string[]) {
        const projects = [] as any[];
        const stack: string[] = [];
        const contentIndentUnit = detectContentIndentUnit(linesArr);
        const contentIndentLen = (contentIndentUnit || indentUnit).length || 1;

        const projectSeparator =
            (config &&
                config.archive &&
                config.archive.project &&
                config.archive.project.separator) ||
            '.';

        for (let i = 0; i < linesArr.length; i++) {
            const line = linesArr[i];
            const match = line.match(projectParts);

            if (match) {
                const indent = match[1] || '';
                const name = match[2];
                const level = Math.floor(indent.length / contentIndentLen);

                while (stack.length > level) stack.pop();
                stack.push(name);

                projects.push({
                    fullPath: stack.join(projectSeparator),
                    name,
                    level,
                    start: i,
                    end: linesArr.length - 1,
                });
            }
        }

        // Compute end lines. For each project, the end is the line before the
        // next project header of equal/lesser depth, or the first line after the
        // project's start that has an indentation level <= project.level (this
        // handles trailing content and lower-indented items that indicate the
        // project's block has ended).
        for (let i = 0; i < projects.length; i++) {
            const p = projects[i];

            // Default end is the last line; we'll narrow it down if we find a
            // next project header or a lower-indented line.
            p.end = linesArr.length - 1;

            // First, if there's a following project header at level <= p.level,
            // that determines the end.
            for (let j = i + 1; j < projects.length; j++) {
                const q = projects[j];
                if (q.level <= p.level) {
                    p.end = q.start - 1;
                    break;
                }
            }

            // Next, scan forward from p.start+1 and if we find a line whose
            // indentation level is <= this project level, we consider that the
            // project ended before that line. This helps when there are no
            // further project headers, but there is content at the same or
            // lower indentation.
            for (let k = p.start + 1; k < linesArr.length; k++) {
                const line = linesArr[k];
                // skip empty lines
                if (!line || !line.trim()) continue;
                const indentLen = getIndentLevel(line, contentIndentUnit || indentUnit);
                if (indentLen <= p.level) {
                    p.end = Math.min(p.end, k - 1);
                    break;
                }
            }
        }

        return projects;
    }

    function ensureProjectChain(projectsArr: string[]) {
        // Ensure project headers exist in lines; create them at end if missing
        for (let i = 0; i < projectsArr.length; i++) {
            const projectSeparator =
                (config &&
                    config.archive &&
                    config.archive.project &&
                    config.archive.project.separator) ||
                '.';
            const subPath = projectsArr.slice(0, i + 1).join(projectSeparator);
            let parsed = parseProjects(lines);
            const contentIndentUnit = detectContentIndentUnit(lines) || indentUnit;
            const existing = parsed.find((p) => p.fullPath === subPath);
            // Compute base indent level for the existing projects so any headers
            // we create match the current archive indentation and nesting levels.
            const parsedMinLevel = parsed.length
                ? Math.min(...parsed.map((p) => p.level))
                : undefined;
            const baseLevel =
                parsedMinLevel !== undefined
                    ? Math.max(rootIndentLevel, parsedMinLevel)
                    : rootIndentLevel;
            if (!existing) {
                // If there's a parent project, insert this header right after
                // the parent project's block (keeping the hierarchy). Otherwise
                // append to the end of file.
                const parentPath = projectsArr.slice(0, i).join(projectSeparator);
                const parent = parsed.find((p) => p.fullPath === parentPath);
                const indent = (contentIndentUnit || indentUnit).repeat(baseLevel + i);
                const header = `${indent}${projectsArr[i]}:`;

                if (parent) {
                    // insert directly under the parent header (so it appears
                    // at the top of the parent's block). Using parent.start + 1
                    // avoids placing the new header after all existing children
                    // and ensures it will be recognized as part of the parent's
                    // subtree for subsequent inserts.
                    const insertAt = parent.start + 1;
                    lines.splice(insertAt, 0, header);
                } else {
                    lines.push(header);
                }

                // Recompute parsed structure for subsequent iterations
                parsed = parseProjects(lines);
            }
        }
    }

    // Process each insert item sequentially to maintain ordering
    const projectInsertCounts = {} as any; // projectPath => number of non-empty lines previously inserted
    insertItems.forEach((ins) => {
        const obj = ins.obj || ins; // support older shapes
        // Remove project tags from insert text
        const text = (obj.text || '').replace(projectTagRegex, '');
        const projectSeparator =
            (config &&
                config.archive &&
                config.archive.project &&
                config.archive.project.separator) ||
            '.';
        const projectPath =
            obj.projects && obj.projects.length ? obj.projects.join(projectSeparator) : undefined;
        const textLinesRaw = text.split('\n').map((l) => l.replace(projectTagRegex, ''));
        const textLines = textLinesRaw.filter((line) => !projectParts.test(line));

        if (projectPath) {
            // Ensure chain
            ensureProjectChain(obj.projects as string[]);

            // Recompute projects map
            const parsed = parseProjects(lines);
            const target = parsed.find((p) => p.fullPath === projectPath);

            if (target) {
                // Insert after the header, so new items appear at the top of the
                // project's list. Use a per-project inserted count to avoid
                // reordering when multiple items are inserted to the same
                // project: the first processed (newest) item stays on top.
                const alreadyInserted = projectInsertCounts[projectPath] || 0;
                // Ensure insertion index is inside the target project's block
                const tentative = target.start + 1 + alreadyInserted;
                const insertAt = Math.min(tentative, target.end + 1);
                // DEBUG LOG
                // debug logs removed

                // If inserting under a found project header, normalize the
                // indentation of the incoming block so relative indentation is
                // preserved while aligning with the target header's level.
                const nonEmptyLines = textLines.filter((l) => (l || '').trim().length > 0);
                const insertedIndentUnit = detectContentIndentUnit(textLines) || indentUnit;
                const blockMinIndent = nonEmptyLines.length
                    ? Math.min(...nonEmptyLines.map((l) => getIndentLevel(l, insertedIndentUnit)))
                    : 0;
                const desiredBaseLevel = (target.level || 0) + 1; // one level inside the header

                const normalized = textLines.map((l) => {
                    const trimmed = l.trim();
                    if (!trimmed) return '';
                    const curLevel = getIndentLevel(l, insertedIndentUnit);
                    const rel = curLevel - blockMinIndent;
                    const newLevel = Math.max(0, desiredBaseLevel + rel);
                    const contentIndentUnit = detectContentIndentUnit(lines) || indentUnit;
                    return `${contentIndentUnit.repeat(newLevel)}${trimmed}`;
                });

                // debug logs removed
                lines.splice(insertAt, 0, ...normalized);
                // Count non-empty lines inserted to track subsequent inserts
                const insertedCount = normalized.filter((l) => (l || '').trim()).length;
                projectInsertCounts[projectPath] =
                    (projectInsertCounts[projectPath] || 0) + insertedCount;
            } else {
                // Fallback to appending at end
                lines.push(...textLines);
            }
        } else {
            // No project, treat as root-level content and prepend it to the archive body
            insertIntoRoot(textLines);
        }
    });

    return lines.join('\n');
}

export default mergeInsertItemsIntoArchiveContent;
