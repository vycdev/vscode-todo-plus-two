import * as _ from 'lodash';

export const hasEmbeddedMatch = (content: string, regex: RegExp): boolean => {
    const matcher = new RegExp(regex.source, regex.flags);

    return content.split(/\r?\n/).some((line) => {
        matcher.lastIndex = 0;

        return matcher.test(_.trimStart(line));
    });
};
