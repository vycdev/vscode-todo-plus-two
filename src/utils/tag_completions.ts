export interface TagArgumentPrefix {
    text: string;
    name: string;
    start: number;
    end: number;
}

const getTagName = (tag: string): string => tag.replace(/\([^)]*\)$/, '');

const isInsideInlineCode = (line: string, character: number): boolean => {
    const markerRuns = /`+/g,
        prefix = line.slice(0, character);
    let delimiterLength = 0;
    let marker: RegExpExecArray | null;

    while ((marker = markerRuns.exec(prefix))) {
        const runLength = marker[0].length;

        if (!delimiterLength) delimiterLength = runLength;
        else if (runLength === delimiterLength) delimiterLength = 0;
    }

    return delimiterLength > 0;
};

export const getTagArgumentPrefix = (
    line: string,
    character: number
): TagArgumentPrefix | undefined => {
    const beforeCursor = line.substring(0, character);

    if (isInsideInlineCode(line, character)) return;

    const match = beforeCursor.match(/(?:^|[^a-zA-Z0-9`])(@[^\s*~(`]+\([^`)]*)$/);

    if (!match || line[character] === ')') return;

    const text = match[1];
    const openingParenthesis = text.indexOf('(');

    return {
        text,
        name: text.substring(0, openingParenthesis),
        start: character - text.length,
        end: character,
    };
};

export const getTagNames = (tags: string[]): string[] => {
    return tags.reduce((names: string[], tag) => {
        const name = getTagName(tag);
        const nameLower = name.toLowerCase();

        if (!names.some((existing) => existing.toLowerCase() === nameLower)) names.push(name);

        return names;
    }, []);
};

export const getTagNameCompletions = (tags: string[], namesInference: boolean): string[] => {
    return namesInference ? getTagNames(tags) : [];
};

export const getTagArguments = (tags: string[], name: string): string[] => {
    const nameLower = name.toLowerCase();

    return tags.reduce((matches: string[], tag) => {
        if (
            /\([^)]*\)$/.test(tag) &&
            getTagName(tag).toLowerCase() === nameLower &&
            matches.indexOf(tag) < 0
        ) {
            matches.push(tag);
        }

        return matches;
    }, []);
};

export const getTagArgumentCompletions = (
    tags: string[],
    prefix?: TagArgumentPrefix
): string[] | undefined => {
    if (!prefix) return;
    if (/^@(id|depends)$/i.test(prefix.name)) return [];

    return getTagArguments(tags, prefix.name);
};
