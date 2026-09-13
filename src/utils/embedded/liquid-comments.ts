import * as _ from 'lodash';
import { parseEmbeddedMatches } from './regex';

interface LiquidCommentMatch {
  lineNr: number;
  column: number;
  todo: string;
  type: string;
  message?: string;
  code: string;
}

const standardCommentTag = /{%-?\s*(comment|endcomment)\b[^%]*?-?%}/gi;
const liquidBlockStart = /{%-?\s*liquid\b/i;
const liquidCommentStart = /^comment\b/i;
const liquidCommentEnd = /^endcomment\b/i;

export const isLiquidFilePath = (filePath: string): boolean => /\.liquid$/i.test(filePath);

const parseCommentText = (
  rawLine: string,
  text: string,
  offset: number,
  lineNr: number,
  regex: RegExp
): LiquidCommentMatch[] => {
  const leadingWhitespace = text.length - _.trimStart(text).length,
    content = _.trimStart(text);

  if (!content) return [];

  const prefix = '{% comment %} ',
    matches = parseEmbeddedMatches(`${prefix}${content} {% endcomment %}`, regex);

  return matches.map((match) => {
    const markerOffset = content.toUpperCase().indexOf(match.type.toUpperCase()),
      column = offset + leadingWhitespace + Math.max(markerOffset, 0),
      todo = match.todo.startsWith(prefix) ? match.todo.slice(prefix.length).trimRight() : content;

    return {
      ...match,
      lineNr,
      column,
      todo,
      code: rawLine.slice(0, column),
    };
  });
};

export const parseLiquidBlockCommentMatches = (
  lines: string[],
  regex: RegExp
): LiquidCommentMatch[] => {
  const matches: LiquidCommentMatch[] = [];
  let inStandardComment = false,
    inLiquidBlock = false,
    inLiquidComment = false;

  lines.forEach((rawLine, lineNr) => {
    const trimmedLine = _.trimStart(rawLine);

    if (inStandardComment) {
      standardCommentTag.lastIndex = 0;
      const closingTag = standardCommentTag.exec(rawLine);

      matches.push(
        ...parseCommentText(
          rawLine,
          closingTag ? rawLine.slice(0, closingTag.index) : rawLine,
          0,
          lineNr,
          regex
        )
      );
    }

    standardCommentTag.lastIndex = 0;
    let tag: RegExpExecArray | null;
    while ((tag = standardCommentTag.exec(rawLine))) {
      inStandardComment = tag[1].toLowerCase() === 'comment';
    }

    if (inLiquidComment) {
      if (liquidCommentEnd.test(trimmedLine)) {
        inLiquidComment = false;
      } else if (/^-?%}/.test(trimmedLine)) {
        inLiquidComment = false;
        inLiquidBlock = false;
      } else {
        matches.push(...parseCommentText(rawLine, rawLine, 0, lineNr, regex));
      }
    } else if (inLiquidBlock && liquidCommentStart.test(trimmedLine)) {
      inLiquidComment = true;
    }

    if (liquidBlockStart.test(trimmedLine)) {
      const openingEnd = trimmedLine.indexOf('%}');
      inLiquidBlock = openingEnd < 0;
    } else if (inLiquidBlock && /^-?%}/.test(trimmedLine)) {
      inLiquidBlock = false;
      inLiquidComment = false;
    }
  });

  return matches;
};
