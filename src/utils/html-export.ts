import { formattingRegexes } from './formatting';

export type HtmlExportLineKind = 'project' | 'todo' | 'comment';
export type HtmlExportTodoStatus = 'pending' | 'done' | 'cancelled';

export interface HtmlExportLine {
    kind: HtmlExportLineKind;
    level: number;
    text: string;
    status?: HtmlExportTodoStatus;
}

const escapeHtml = (text: string): string =>
    text.replace(/[&<>"']/g, (character) => {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };

        return entities[character];
    });

const renderFormattedText = (text: string): string => {
    const regex = formattingRegexes.formatted;
    let cursor = 0;
    let rendered = '';
    let match: RegExpExecArray | null;

    regex.lastIndex = 0;

    while ((match = regex.exec(text))) {
        rendered += escapeHtml(text.slice(cursor, match.index));

        const formatted = match.slice(1, 5).filter(Boolean)[0],
            delimiter = formatted[0],
            tag =
                delimiter === '`'
                    ? 'code'
                    : delimiter === '*'
                      ? 'strong'
                      : delimiter === '_'
                        ? 'em'
                        : 'del';

        rendered += `<${tag}>${escapeHtml(formatted.slice(1, -1))}</${tag}>`;
        cursor = match.index + match[0].length;
    }

    regex.lastIndex = 0;

    return rendered + escapeHtml(text.slice(cursor));
};

const renderLine = (line: HtmlExportLine): string => {
    const text = renderFormattedText(line.text);

    if (line.kind === 'project') {
        return `<li class="project"><span class="project-title">${text}</span>`;
    }

    if (line.kind === 'todo') {
        const status = line.status || 'pending',
            labels = {
                pending: 'Pending',
                done: 'Done',
                cancelled: 'Cancelled',
            },
            markers = {
                pending: '☐',
                done: '✔',
                cancelled: '✘',
            };

        return `<li class="todo ${status}"><span class="todo-marker" aria-hidden="true">${markers[status]}</span><span class="screen-reader-only">${labels[status]}: </span><span class="todo-text">${text}</span>`;
    }

    return `<li class="comment"><span class="comment-text">${text}</span>`;
};

const renderTree = (lines: HtmlExportLine[]): string => {
    if (!lines.length) return '<p class="empty">No content to export.</p>';

    const openLevels: number[] = [];
    let html = '<ul class="todo-tree">\n';

    lines.forEach((line) => {
        const level = Math.max(0, line.level);

        if (!openLevels.length) {
            html += renderLine(line);
            openLevels.push(level);
            return;
        }

        const currentLevel = openLevels[openLevels.length - 1];

        if (level > currentLevel) {
            html += '\n<ul>\n' + renderLine(line);
            openLevels.push(level);
            return;
        }

        html += '</li>\n';

        while (openLevels.length > 1 && level <= openLevels[openLevels.length - 2]) {
            html += '</ul>\n</li>\n';
            openLevels.pop();
        }

        openLevels[openLevels.length - 1] = level;
        html += renderLine(line);
    });

    html += '</li>\n';

    while (openLevels.length > 1) {
        html += '</ul>\n</li>\n';
        openLevels.pop();
    }

    return html + '</ul>';
};

export const renderTodoHtml = (title: string, lines: HtmlExportLine[]): string => `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>${escapeHtml(title)}</title>
    <style>
        body { color: #24292f; background: #fff; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; }
        main { box-sizing: border-box; max-width: 900px; margin: 0 auto; padding: 2rem; }
        h1 { border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
        ul { list-style: none; margin: .25rem 0; padding-left: 1.5rem; }
        .todo-tree { padding-left: 0; }
        li { margin: .2rem 0; }
        .project-title { font-size: 1.15em; font-weight: 600; }
        .todo-marker { display: inline-block; width: 1.5em; }
        .todo.done .todo-text, .todo.cancelled .todo-text { text-decoration: line-through; opacity: .7; }
        .todo.cancelled .todo-marker { color: #b42318; }
        .comment { color: #57606a; font-style: italic; }
        .screen-reader-only { clip: rect(0, 0, 0, 0); clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
        .empty { color: #57606a; font-style: italic; }
        code { background: #eff1f3; border-radius: 3px; padding: .1em .3em; }
    </style>
</head>
<body>
    <main>
        <h1>${escapeHtml(title)}</h1>
        ${renderTree(lines)}
    </main>
</body>
</html>
`;
