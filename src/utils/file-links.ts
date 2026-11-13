/* IMPORT */

import * as path from 'path';
import { parseCodeBlocks } from './code-blocks';
import { maskInlineCode } from './todo-status';

/* RELATIVE FILE LINKS */

const relativeFileLinkRegex = /(^|[\s([<{"'`])file:\/\/(?:\.{1,2}\/)[^\s<>"'`]+/gi;
const trailingPunctuationRegex = /[),.;:!?\]}]$/;
const openingDelimiter = { ')': '(', ']': '[', '}': '{' };

const trimTrailingPunctuation = (link: string): string => {
  while (trailingPunctuationRegex.test(link)) {
    const closing = link[link.length - 1],
      opening = openingDelimiter[closing];

    // Count URL-encoded delimiters too: an encoded opening bracket can pair
    // with a literal closing bracket in the filename (and vice versa).
    const balancedPath = link.replace(/%(28|29|5b|5d|7b|7d)/gi, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    const isBalanced =
      opening && balancedPath.split(opening).length >= balancedPath.split(closing).length;
    if (isBalanced) break;
    link = link.slice(0, -1);
  }
  return link;
};

export interface RelativeFileLink {
  start: number;
  end: number;
  targetPath: string;
}

export const makeRelativeFileLink = (documentPath: string, targetPath: string): string => {
  const relativePath = path.relative(path.dirname(documentPath), targetPath);
  if (path.isAbsolute(relativePath))
    throw new Error('Cannot link files on different filesystem roots');
  const encodedPath = relativePath
    .split(path.sep)
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/')
    // A literal terminal period is stripped as sentence punctuation when links are read.
    .replace(/\.$/, '%2E');
  return `file://${encodedPath.startsWith('../') ? '' : './'}${encodedPath}`;
};

export const rebaseRelativeFileLinks = (
  text: string,
  sourcePath: string,
  destinationPath: string
): string => {
  if (!path.relative(path.dirname(sourcePath), path.dirname(destinationPath))) return text;
  // Keep inline code examples literal without moving the link offsets.
  const links = findRelativeFileLinks(
    maskInlineCode(parseCodeBlocks(text).maskedText, true),
    sourcePath
  );
  // Replace from the end so earlier link ranges stay valid.
  for (const link of links.reverse()) {
    text =
      text.slice(0, link.start) +
      makeRelativeFileLink(destinationPath, link.targetPath) +
      text.slice(link.end);
  }
  return text;
};

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
      const decodedPath = decodeURIComponent(relativePath);
      if (['.', '..'].includes(path.basename(decodedPath))) continue;

      links.push({
        start: match.index + prefixLength,
        end: match.index + prefixLength + value.length,
        targetPath: path.resolve(path.dirname(documentPath), decodedPath),
      });
    } catch (error) {
      // Ignore malformed percent-encoded paths.
    }
  }

  return links;
};
