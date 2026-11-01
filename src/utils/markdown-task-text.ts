const scanTaskText = (text: string, markdown = true) => {
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
      markdown &&
      text[cursor] === '\\' &&
      cursor + 1 < text.length &&
      /[!-/:-@[-`{-~]/.test(text[cursor + 1])
    ) {
      mask(cursor, cursor + 2);
      cursor += 2;
    } else if (markdown && text.startsWith('<!--', cursor)) {
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

const getTaskTags = (text: string, markdown: boolean) => {
  const masked = scanTaskText(text, markdown).masked;
  const pattern = /@[^\s*~(`]+(?:\([^\r\n)]*\))?/g;
  const tags: Array<{ start: number; end: number; text: string }> = [];
  let match: RegExpExecArray;
  while ((match = pattern.exec(masked))) {
    if (match.index && /[a-zA-Z0-9`]/.test(masked[match.index - 1])) continue;
    const end = match.index + match[0].length;
    tags.push({ start: match.index, end, text: text.slice(match.index, end) });
  }
  return tags;
};

/** Read outer tags once, leaving their arguments as literal, portable text. */
export const getMarkdownTaskTags = (text: string) => getTaskTags(text, true);

/** Todo text shares inline-code and argument rules, without Markdown escapes or comments. */
export const getTodoTaskTags = (text: string) => getTaskTags(text, false);

export const findMarkdownTaskTag = (text: string, pattern: RegExp) => {
  for (const tag of getMarkdownTaskTags(text)) {
    pattern.lastIndex = 0;
    const match = pattern.exec(` ${tag.text}`);
    if (!match || match.index + match[0].indexOf('@') !== 1) continue;
    const end = tag.start + match.index + match[0].length - 1;
    return { start: tag.start, end, text: text.slice(tag.start, end) };
  }
};

/** Transform task metadata without rewriting protected literal content. */
export const transformMarkdownTaskText = (
  text: string,
  transform: (visible: string) => string
): string => {
  let result = text;
  getMarkdownTaskTags(text)
    .reverse()
    .forEach((tag) => {
      const transformed = transform(` ${tag.text}`).trimStart();
      const name = tag.text.match(/^@[^\s*~(`]+/)[0];
      // A cleanup may match text inside an argument. Retain the entire original
      // tag whenever its outer name survives the requested transformation.
      if (transformed.startsWith(name)) return;
      const start = tag.start && /[ \t]/.test(text[tag.start - 1]) ? tag.start - 1 : tag.start;
      result = result.slice(0, start) + transformed + result.slice(tag.end);
    });
  const protectedRanges = scanTaskText(text).protectedRanges;
  const last = protectedRanges[protectedRanges.length - 1];
  return last && last.end === text.length ? result : result.trimEnd();
};
