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
    matches = parseEmbeddedMatches(`${prefix}${content}`, regex);

  // Only synthesize a match at the added comment prefix. Real comment
  // delimiters in the content are already handled by the ordinary scanner.
  return matches
    .filter((match) => match.column < prefix.length)
    .map((match) => {
      const markerOffset = content.toUpperCase().indexOf(match.type.toUpperCase()),
        column = offset + leadingWhitespace + Math.max(markerOffset, 0),
        todo = content
          .slice(0, Math.max(0, match.column + match.todo.length - prefix.length))
          .trimRight();

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
  const matches: LiquidCommentMatch[] = [],
    content = lines.join('\n'),
    // Consume complete tags/outputs so a tag name inside an expression does
    // not change comment state. Also tolerate an unfinished tag while editing.
    tokens = /({%-?)([\s\S]*?)(-?%}|$)|{{-?[\s\S]*?(?:-?}}|$)/g,
    rawEnd = /{%-?\s*endraw\b[\s\S]*?-?%}/gi;
  let cursor = 0,
    lineNr = 0,
    lineStart = 0,
    commentDepth = 0,
    inRaw = false;

  // Walk source positions once, retaining original line/column coordinates.
  const consume = (end: number, isComment: boolean) => {
    while (cursor < end) {
      const lineEnd = Math.min(lineStart + lines[lineNr].length, end);
      if (isComment) {
        matches.push(
          ...parseCommentText(
            lines[lineNr],
            content.slice(cursor, lineEnd),
            cursor - lineStart,
            lineNr,
            regex
          )
        );
      }
      cursor = lineEnd;
      if (cursor < end && content[cursor] === '\n') {
        cursor += 1;
        lineNr += 1;
        lineStart = cursor;
      }
    }
  };

  let token: RegExpExecArray | null;
  while ((token = (inRaw ? rawEnd : tokens).exec(content))) {
    consume(token.index, commentDepth > 0);
    const end = token.index + token[0].length,
      nameMatch = token[2] && /^\s*(\w+)\b/.exec(token[2]),
      name = nameMatch ? nameMatch[1].toLowerCase() : '';

    if (inRaw) {
      consume(end, commentDepth > 0);
      inRaw = false;
      tokens.lastIndex = end;
    } else if (name === 'liquid' && !commentDepth) {
      // Inside a liquid tag each newline starts another delimiter-free tag.
      const bodyEnd = end - token[3].length;
      let depth = 0;
      consume(token.index + token[1].length + nameMatch![0].length, false);
      while (cursor < bodyEnd) {
        const lineEnd = Math.min(lineStart + lines[lineNr].length, bodyEnd),
          text = content.slice(cursor, lineEnd).trim(),
          command = /^(comment|endcomment)\b/i.exec(text);
        if (command) {
          depth = command[1].toLowerCase() === 'comment' ? depth + 1 : Math.max(0, depth - 1);
        }
        consume(lineEnd, !command && depth > 0);
        if (cursor < bodyEnd) consume(cursor + 1, false);
      }
      consume(end, false);
    } else {
      consume(end, commentDepth > 0);
      if (name === 'comment') commentDepth += 1;
      else if (name === 'endcomment') commentDepth = Math.max(0, commentDepth - 1);
      else if (name === 'raw') {
        inRaw = true;
        rawEnd.lastIndex = end;
      }
    }
  }
  consume(content.length, commentDepth > 0);

  return matches;
};
