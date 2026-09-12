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
  if (!content) return '<code></code>';

  const needsPadding = (content.startsWith(' ') || content.endsWith(' ')) && !/^ +$/.test(content),
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
      content = formatted.slice(1, -1),
      escaped = escapeMarkdownText(content),
      tag = delimiter === '*' ? 'strong' : delimiter === '_' ? 'em' : 's',
      marker = delimiter === '*' ? '**' : delimiter === '_' ? '_' : '~~',
      // Todo permits formatting where Markdown delimiters cannot open or close.
      needsInlineHtml =
        /^\s|\s$/.test(content) ||
        /\S/.test(text.charAt(match.index - 1)) ||
        /\S/.test(text.charAt(match.index + match[0].length));

    rendered +=
      delimiter === '`'
        ? renderCodeSpan(content)
        : needsInlineHtml
          ? `<${tag}>${escaped}</${tag}>`
          : `${marker}${escaped}${marker}`;
    cursor = match.index + match[0].length;
  }

  regex.lastIndex = 0;

  return rendered + escapeMarkdownText(text.slice(cursor));
};

const renderLine = (line: MarkdownExportLine, depth: number): string => {
  const indentation = '  '.repeat(depth),
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

  const levels: number[] = [],
    rendered = lines.map((line) => {
      const level = Math.max(0, line.level);

      while (levels.length && level <= levels[levels.length - 1]) levels.pop();

      const result = renderLine(line, levels.length);
      levels.push(level);
      return result;
    });

  return `${heading}\n\n${rendered.join('\n')}\n`;
};
