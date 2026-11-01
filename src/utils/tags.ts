import { maskInlineCode } from './todo-status';

/* TAGS */

function escapeRegExp(str: string) {
  return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

/** Outer tag arguments contain literal metadata, not additional active tags. */
export const getTagArgumentRanges = (text: string): { start: number; end: number }[] => {
  const masked = maskInlineCode(text, true),
    regex = /(?<![a-zA-Z0-9@])@[^\s*~(`@]+\([^\r\n)]*\)/g,
    ranges: { start: number; end: number }[] = [];
  let match: RegExpExecArray;
  while ((match = regex.exec(masked))) {
    ranges.push({ start: match.index + match[0].indexOf('(') + 1, end: regex.lastIndex - 1 });
  }
  return ranges;
};

const Tags = {
  normalizeNames(tags: string[] = []): string[] {
    const values = Array.isArray(tags) ? tags : [tags];
    const names: string[] = [];

    values.forEach((tag) => {
      const name = String(tag || '')
        .replace(/^@+/, '')
        .trim();

      if (name && names.indexOf(name) < 0) names.push(name);
    });

    return names;
  },

  remove(text: string, tags: string[] = []) {
    const names = Tags.normalizeNames(tags);

    if (!names.length) return text;

    const masked = maskInlineCode(text, true),
      argumentsRanges = getTagArgumentRanges(text),
      regex = new RegExp(
        `(^|[^a-zA-Z0-9])@(?:${names
          .map((name) => escapeRegExp(name))
          .join('|')})(?:(?:\\([^)]*\\))|(?=$|[\\s*~(]|[.,;:!?()\\[\\]{}<>"']+(?:$|[\\s*~(])))`,
        'g'
      );

    return text
      .replace(regex, (match, prefix, offset) => {
        const start = offset + prefix.length;
        if (
          masked[start] === ' ' ||
          argumentsRanges.some((range) => start >= range.start && start < range.end)
        )
          return match;

        return prefix && /\S/.test(prefix) ? prefix : '';
      })
      .trimRight();
  },

  removeAll(text: string) {
    const regex = /(^|[^a-zA-Z0-9])(@[^\s*~(`]+)(\([^)]*\))?/gm,
      masked = maskInlineCode(text, true);

    return text
      .replace(regex, (match, prefix, tagName, _argument, offset, source) => {
        if (masked[offset + prefix.length] === ' ') return match;

        const trailingMatch = tagName.match(/[.,;:!?()[\]{}<>"']+$/),
          trailing = trailingMatch ? trailingMatch[0] : '',
          name = trailing ? tagName.slice(0, -trailing.length) : tagName;

        if (name === '@') return match;

        const beforeMatch = source.slice(0, offset).trimRight(),
          punctuation =
            trailing && beforeMatch.slice(-1) === trailing.charAt(0) ? trailing.slice(1) : trailing;

        return (prefix && /\S/.test(prefix) ? prefix : '') + punctuation;
      })
      .trimRight();
  },
};

/* EXPORT */

export default Tags;
