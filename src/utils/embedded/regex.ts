import * as _ from 'lodash';
import { splitLines } from '../line-splitting';

export const parseEmbeddedMatches = (line: string, regex: RegExp) => {
  const matcher = new RegExp(regex.source, regex.flags);
  const matches = [];
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(line))) {
    if (match[0] && match[1]) {
      matches.push({
        column: match.index,
        todo: match[0],
        type: match[1].toUpperCase(),
        message: match[2],
        code: line.slice(0, match.index),
      });
    }

    if (!matcher.global) break;
    if (!match[0]) {
      // RegExp.exec does not advance empty global matches. Advance by a
      // code point so custom expressions cannot stall the extension host.
      const width = matcher.unicode && line.codePointAt(match.index)! > 0xffff ? 2 : 1;
      matcher.lastIndex = match.index + width;
    }
  }

  return matches;
};

export const hasEmbeddedMatch = (content: string, regex: RegExp): boolean => {
  const matcher = new RegExp(regex.source, regex.flags);

  return splitLines(content).some((line) => {
    matcher.lastIndex = 0;

    return matcher.test(_.trimStart(line));
  });
};
