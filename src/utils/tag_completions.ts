export interface TagArgumentPrefix {
    text: string;
    name: string;
    start: number;
    end: number;
}

const getTagName = (tag: string): string => tag.replace(/\([^)]*\)$/, '');

export const getTagArgumentPrefix = (
    line: string,
    character: number
): TagArgumentPrefix | undefined => {
    const beforeCursor = line.substring(0, character);
    const match = beforeCursor.match(/(?:^|[^a-zA-Z0-9`])(@[^\s*~(]+\([^)]*)$/);

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
