import { getTodoTaskTags } from './markdown-task-text';

/* INLINE CODE */

export const getInlineCodeRanges = (
  text: string,
  literalTagArguments: boolean = false
): { start: number; end: number }[] => {
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (
      literalTagArguments &&
      text[cursor] === '@' &&
      (cursor === 0 || !/[a-zA-Z0-9@]/.test(text[cursor - 1]))
    ) {
      const tag = /^@[^\s*~(`@]+\([^\r\n)]*\)/.exec(text.slice(cursor));
      if (tag) {
        cursor += tag[0].length;
        continue;
      }
    }
    if (text[cursor] !== '`') {
      cursor++;
      continue;
    }

    const openingStart = cursor;

    while (cursor < text.length && text[cursor] === '`') cursor++;

    const delimiterLength = cursor - openingStart;
    let search = cursor;
    let closingEnd = -1;

    while (search < text.length && text[search] !== '\n' && text[search] !== '\r') {
      if (text[search] !== '`') {
        search++;
        continue;
      }

      const runStart = search;

      while (search < text.length && text[search] === '`') search++;

      if (search - runStart === delimiterLength) {
        closingEnd = search;
        break;
      }
    }

    if (closingEnd < 0) continue;

    ranges.push({ start: openingStart, end: closingEnd });
    cursor = closingEnd;
  }

  return ranges;
};

export const maskInlineCode = (text: string, literalTagArguments: boolean = false): string => {
  const masked = text.split('');
  getInlineCodeRanges(text, literalTagArguments).forEach(({ start, end }) => {
    for (let index = start; index < end; index++) masked[index] = ' ';
  });
  return masked.join('');
};

/* TODO STATUS */

/** Hide inline code and Todo tag arguments, keeping original offsets. */
export const maskTodoStatusText = (text: string): string => {
  // Tag arguments are plain text. Mask them before scanning backticks so a
  // literal backtick inside an argument cannot hide a later real status tag.
  const masked = text.split('');
  getTodoTaskTags(text).forEach(({ start, text: tag }) => {
    const open = tag.indexOf('(');
    if (open < 0 || !tag.endsWith(')')) return;
    for (let index = start + open + 1; index < start + tag.length - 1; index++) {
      masked[index] = ' ';
    }
  });
  return maskInlineCode(masked.join(''));
};

export const matchesTodoStatus = (text: string, pattern: RegExp): boolean => {
  pattern.lastIndex = 0;

  return pattern.test(maskTodoStatusText(text));
};

export const removeTodoStatusTag = (
  text: string,
  pattern: RegExp,
  mask = maskTodoStatusText
): string => {
  pattern.lastIndex = 0;

  const match = pattern.exec(mask(text));

  if (!match) return text;

  // The tag-boundary regex includes the character before @. Keep punctuation,
  // but consume the separating whitespace as before.
  const boundary = match[0][0];
  const prefix = boundary !== '@' && !/\s/.test(boundary) ? boundary : '';
  return text.slice(0, match.index) + prefix + text.slice(match.index + match[0].length);
};
