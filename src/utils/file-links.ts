/* IMPORT */

import * as path from 'path';

/* RELATIVE FILE LINKS */

const relativeFileLinkRegex = /(^|[\s([<{"'`])file:\/\/(?:\.{1,2}\/)[^\s<>"'`]+/g;
const trailingPunctuationRegex = /[),.;:!?\]}]$/;
const openingDelimiter = { ')': '(', ']': '[', '}': '{' };

const trimTrailingPunctuation = (link: string): string => {
  while (trailingPunctuationRegex.test(link)) {
    const closing = link[link.length - 1],
      opening = openingDelimiter[closing];

    // A balanced closer belongs to the filename; an unmatched one wraps the link.
    if (opening && link.split(opening).length >= link.split(closing).length) break;
    link = link.slice(0, -1);
  }
  return link;
};

export interface RelativeFileLink {
  start: number;
  end: number;
  targetPath: string;
}

export const findRelativeFileLinks = (text: string, documentPath: string): RelativeFileLink[] => {
  const links: RelativeFileLink[] = [];
  let match: RegExpExecArray | null;

  relativeFileLinkRegex.lastIndex = 0;

  while ((match = relativeFileLinkRegex.exec(text))) {
    const prefixLength = match[1].length,
      value = trimTrailingPunctuation(match[0].slice(prefixLength)),
      relativePath = value.slice('file://'.length);

    if (!relativePath || /[?#]/.test(value)) continue;

    try {
      links.push({
        start: match.index + prefixLength,
        end: match.index + prefixLength + value.length,
        targetPath: path.resolve(path.dirname(documentPath), decodeURIComponent(relativePath)),
      });
    } catch (error) {
      // Ignore malformed percent-encoded paths.
    }
  }

  return links;
};
