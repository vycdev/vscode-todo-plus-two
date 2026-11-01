/* INLINE CODE */

export const getInlineCodeRanges = (text: string): { start: number; end: number }[] => {
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;

  while (cursor < text.length) {
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

export const maskInlineCode = (text: string): string => {
  const masked = text.split('');
  getInlineCodeRanges(text).forEach(({ start, end }) => {
    for (let index = start; index < end; index++) masked[index] = ' ';
  });
  return masked.join('');
};

/* TODO STATUS */

export const matchesTodoStatus = (text: string, pattern: RegExp): boolean => {
  pattern.lastIndex = 0;

  return pattern.test(maskInlineCode(text));
};

export const removeTodoStatusTag = (
  text: string,
  pattern: RegExp,
  mask = maskInlineCode
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
