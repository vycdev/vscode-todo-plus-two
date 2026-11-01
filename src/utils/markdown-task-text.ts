const scanTaskText = (text: string) => {
  const masked = text.split('');
  const comments: Array<{ start: number; end: number; closed: boolean }> = [];
  const protectedRanges: Array<{ start: number; end: number }> = [];
  const mask = (start: number, end: number) => {
    protectedRanges.push({ start, end });
    for (let index = start; index < end; index++) {
      if (masked[index] !== '\r' && masked[index] !== '\n') masked[index] = ' ';
    }
  };
  let cursor = 0;
  while (cursor < text.length) {
    if (
      text[cursor] === '\\' &&
      cursor + 1 < text.length &&
      /[!-/:-@[-`{-~]/.test(text[cursor + 1])
    ) {
      mask(cursor, cursor + 2);
      cursor += 2;
    } else if (text.startsWith('<!--', cursor)) {
      const closing = text.indexOf('-->', cursor + 4);
      const end = closing < 0 ? text.length : closing + 3;
      comments.push({ start: cursor, end, closed: closing >= 0 });
      mask(cursor, end);
      cursor = end;
    } else if (text[cursor] === '@' && (cursor === 0 || !/[a-zA-Z0-9`]/.test(text[cursor - 1]))) {
      const tag = /^@[^\s*~(`]+\(/.exec(text.slice(cursor));
      const closing = tag ? text.indexOf(')', cursor + tag[0].length) : -1;
      // Tag arguments are portable plaintext, including backslashes and other
      // characters that would otherwise be Markdown formatting or escapes.
      if (closing >= 0 && !/[\r\n]/.test(text.slice(cursor, closing))) cursor = closing + 1;
      else cursor++;
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
  return { masked: masked.join(''), comments, protectedRanges };
};

/** Code and comments protect their contents from each other's delimiters. */
export const getMarkdownCommentRanges = (text: string) => scanTaskText(text).comments;

/** Keep original UTF-16 offsets while hiding escaped text, code and comments. */
export const maskMarkdownTaskText = (text: string): string => scanTaskText(text).masked;

/** Transform task metadata without rewriting protected literal content. */
export const transformMarkdownTaskText = (
  text: string,
  transform: (visible: string) => string
): string => {
  let result = '';
  let cursor = 0;
  scanTaskText(text).protectedRanges.forEach(({ start, end }) => {
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
