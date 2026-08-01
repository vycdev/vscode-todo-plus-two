const escapeRegExp = (value: string): string => {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
};

const tagArgumentOrBoundary = '(?:(?:\\([^)]*\\))|(?![a-zA-Z]))';
const normalTag = '(@[^\\s*~(]+(?::\\/\\/[^\\s*~(:]+)?(?:(?:\\([^)]*\\))|(?![a-zA-Z])))';

export const createTagRegexes = (tagNames: string[] = []) => {
    const specialNames = tagNames.map((name) => escapeRegExp(String(name || ''))).filter(Boolean);
    const specialTags = specialNames.map((name) => `(@${name}${tagArgumentOrBoundary})`);
    const normalExclusions = specialNames.concat([
        'created',
        'done',
        'cancelled',
        'started',
        'lasted',
        'wasted',
        'est',
        '\\d',
    ]);

    return {
        tagSpecial: specialNames.length
            ? new RegExp(
                  `(?:^|[^a-zA-Z0-9])@(${specialNames.join('|')})${tagArgumentOrBoundary}`,
                  'gm'
              )
            : /(?=a)b/gm,
        tagSpecialNormal: new RegExp(
            `(?:^|[^a-zA-Z0-9])(?:${specialTags.concat(normalTag).join('|')})`,
            'gm'
        ),
        tagNormal: new RegExp(
            `(?:^|[^a-zA-Z0-9])@(?!${normalExclusions.join('|')})[^\\s*~(:]+(?::\\/\\/[^\\s*~(:]+)?(?:\\([^)]*\\))?`
        ),
    };
};
