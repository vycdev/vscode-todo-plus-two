/* INLINE CODE */

export const maskInlineCode = (text: string): string => {
    const masked = text.split('');
    let cursor = 0;

    while (cursor < text.length) {
        if (text[cursor] !== '`') {
            cursor++;
            continue;
        }

        const openingStart = cursor;

        while (cursor < text.length && text[cursor] === '`') cursor++;

        const delimiterLength = cursor - openingStart;
        let search = cursor;
        let closingEnd = -1;

        while (search < text.length && text[search] !== '\n' && text[search] !== '\r') {
            if (text[search] !== '`') {
                search++;
                continue;
            }

            const runStart = search;

            while (search < text.length && text[search] === '`') search++;

            if (search - runStart === delimiterLength) {
                closingEnd = search;
                break;
            }
        }

        if (closingEnd < 0) continue;

        for (let index = openingStart; index < closingEnd; index++) masked[index] = ' ';

        cursor = closingEnd;
    }

    return masked.join('');
};

/* TODO STATUS */

export const matchesTodoStatus = (text: string, pattern: RegExp): boolean => {
    pattern.lastIndex = 0;

    return pattern.test(maskInlineCode(text));
};

export const removeTodoStatusTag = (text: string, pattern: RegExp): string => {
    pattern.lastIndex = 0;

    const match = pattern.exec(maskInlineCode(text));

    if (!match) return text;

    return text.slice(0, match.index) + text.slice(match.index + match[0].length);
};
