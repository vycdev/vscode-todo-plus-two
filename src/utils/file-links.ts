/* IMPORT */

import * as path from 'path';

/* RELATIVE FILE LINKS */

const relativeFileLinkRegex = /(^|[\s([<{"'`])file:\/\/(?:\.{1,2}\/)[^\s<>"'`]+/g;
const trailingPunctuationRegex = /[),.;:!?\]}]+$/;

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
            value = match[0].slice(prefixLength).replace(trailingPunctuationRegex, ''),
            relativePath = value.slice('file://'.length);

        if (!relativePath || /[?#]/.test(value)) continue;

        try {
            links.push({
                start: match.index + prefixLength,
                end: match.index + prefixLength + value.length,
                targetPath: path.resolve(
                    path.dirname(documentPath),
                    decodeURIComponent(relativePath)
                ),
            });
        } catch (error) {
            // Ignore malformed percent-encoded paths.
        }
    }

    return links;
};
