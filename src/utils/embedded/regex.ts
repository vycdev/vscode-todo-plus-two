import * as _ from 'lodash';
import stringMatches from 'string-matches';
import { splitLines } from '../line-splitting';

export const parseEmbeddedMatches = (line: string, regex: RegExp) =>
    stringMatches(line, regex).map((match) => ({
        todo: match[0],
        type: match[1].toUpperCase(),
        message: match[2],
        code: line.slice(0, match.index),
    }));

export const hasEmbeddedMatch = (content: string, regex: RegExp): boolean => {
    const matcher = new RegExp(regex.source, regex.flags);

    return splitLines(content).some((line) => {
        matcher.lastIndex = 0;

        return matcher.test(_.trimStart(line));
    });
};
