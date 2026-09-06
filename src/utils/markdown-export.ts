import { formattingRegexes } from './formatting';

export type MarkdownExportLineKind = 'project' | 'todo' | 'comment';
export type MarkdownExportTodoStatus = 'pending' | 'done' | 'cancelled';

export interface MarkdownExportLine {
    kind: MarkdownExportLineKind;
    level: number;
    text: string;
    status?: MarkdownExportTodoStatus;
}

const escapeMarkdownText = (text: string): string => text.replace(/[!-/:-@[-`{-~]/g, '\\$&');

const renderCodeSpan = (content: string): string => {
    const needsPadding =
            (content.startsWith(' ') || content.endsWith(' ')) && !/^ +$/.test(content),
        padding = needsPadding ? ' ' : '';

    return `\`${padding}${content}${padding}\``;
};

const renderFormattedText = (text: string): string => {
    const regex = formattingRegexes.formatted;
    let cursor = 0;
    let rendered = '';
    let match: RegExpExecArray | null;

    regex.lastIndex = 0;

    while ((match = regex.exec(text))) {
        rendered += escapeMarkdownText(text.slice(cursor, match.index));

        const formatted = match.slice(1, 5).filter(Boolean)[0],
            delimiter = formatted[0],
            content = formatted.slice(1, -1);

        rendered +=
            delimiter === '`'
                ? renderCodeSpan(content)
                : delimiter === '*'
                  ? `**${escapeMarkdownText(content)}**`
                  : delimiter === '_'
                    ? `_${escapeMarkdownText(content)}_`
                    : `~~${escapeMarkdownText(content)}~~`;
        cursor = match.index + match[0].length;
    }

    regex.lastIndex = 0;

    return rendered + escapeMarkdownText(text.slice(cursor));
};

const renderLine = (line: MarkdownExportLine): string => {
    const indentation = '  '.repeat(Math.max(0, line.level)),
        text = renderFormattedText(line.text);

    if (line.kind === 'project') return `${indentation}- **${text}**`;
    if (line.kind === 'comment') return `${indentation}- ${text}`;

    const status = line.status || 'pending';

    if (status === 'done') return `${indentation}- [x] ${text}`;
    if (status === 'cancelled') return `${indentation}- [ ] ~~${text}~~`;

    return `${indentation}- [ ] ${text}`;
};

export const renderTodoMarkdown = (title: string, lines: MarkdownExportLine[]): string => {
    const heading = `# ${escapeMarkdownText(title)}`;

    if (!lines.length) return `${heading}\n\n_No content to export._\n`;

    return `${heading}\n\n${lines.map(renderLine).join('\n')}\n`;
};
