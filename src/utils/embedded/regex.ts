import * as _ from 'lodash';
import { splitLines } from '../line-splitting';

export const hasEmbeddedMatch = (content: string, regex: RegExp): boolean => {
    const matcher = new RegExp(regex.source, regex.flags);

    return splitLines(content).some((line) => {
        matcher.lastIndex = 0;

        return matcher.test(_.trimStart(line));
    });
};
