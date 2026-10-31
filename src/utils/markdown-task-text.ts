const scanTaskText = (text: string) => {
  const masked = text.split('');
  const comments: Array<{ start: number; end: number; closed: boolean }> = [];
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      if (masked[index] !== '\r' && masked[index] !== '\n') masked[index] = ' ';
    }
  };
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith('<!--', cursor)) {
      const closing = text.indexOf('-->', cursor + 4);
      const end = closing < 0 ? text.length : closing + 3;
      comments.push({ start: cursor, end, closed: closing >= 0 });
      mask(cursor, end);
      cursor = end;
    } else if (text[cursor] === '`') {
      const start = cursor;
      while (cursor < text.length && text[cursor] === '`') cursor++;
      const length = cursor - start;
      let search = cursor;
      while (search < text.length && text[search] !== '\n' && text[search] !== '\r') {
        if (text[search] !== '`') {
          search++;
          continue;
        }
        const run = search;
        while (search < text.length && text[search] === '`') search++;
        if (search - run === length) {
          mask(start, search);
          cursor = search;
          break;
        }
      }
    } else {
      cursor++;
    }
  }
  return { masked: masked.join(''), comments };
};

/** Code and comments protect their contents from each other's delimiters. */
export const getMarkdownCommentRanges = (text: string) => scanTaskText(text).comments;

/** Keep original UTF-16 offsets while hiding literal code and HTML comments. */
export const maskMarkdownTaskText = (text: string): string => scanTaskText(text).masked;

/** Transform task metadata without rewriting hidden comment payloads. */
export const transformMarkdownTaskText = (
  text: string,
  transform: (visible: string) => string
): string => {
  let result = '';
  let cursor = 0;
  getMarkdownCommentRanges(text).forEach(({ start, end }) => {
    const original = text.slice(cursor, start);
    const transformed = transform(original);
    const whitespace = (original.match(/[ \t]+$/) || [''])[0];
    result +=
      transformed +
      (transformed && !/[ \t]$/.test(transformed) ? whitespace : '') +
      text.slice(start, end);
    cursor = end;
  });
  return result + transform(text.slice(cursor));
};
