/* TAGS */

function escapeRegExp(str: string) {
    return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function isInsideInlineCode(text: string, offset: number): boolean {
    const markerRuns = /`+/g,
        prefix = text.slice(0, offset);
    let delimiterLength = 0;
    let marker: RegExpExecArray | null;

    while ((marker = markerRuns.exec(prefix))) {
        const runLength = marker[0].length;

        if (!delimiterLength) delimiterLength = runLength;
        else if (runLength === delimiterLength) delimiterLength = 0;
    }

    return delimiterLength > 0;
}

const Tags = {
    normalizeNames(tags: string[] = []): string[] {
        const values = Array.isArray(tags) ? tags : [tags];
        const names: string[] = [];

        values.forEach((tag) => {
            const name = String(tag || '')
                .replace(/^@+/, '')
                .trim();

            if (name && names.indexOf(name) < 0) names.push(name);
        });

        return names;
    },

    remove(text: string, tags: string[] = []) {
        const names = Tags.normalizeNames(tags);

        if (!names.length) return text;

        const regex = new RegExp(
            `(^|[^a-zA-Z0-9])@(?:${names
                .map((name) => escapeRegExp(name))
                .join(
                    '|'
                )})(?:(?:\\([^)]*\\))|(?=$|[\\s*~(]|[.,;:!?()\\[\\]{}<>"']+(?:$|[\\s*~(])))`,
            'g'
        );

        return text
            .replace(regex, (match, prefix, offset, source) => {
                if (isInsideInlineCode(source, offset + prefix.length)) return match;

                return prefix && /\S/.test(prefix) ? prefix : '';
            })
            .trimRight();
    },

    removeAll(text: string) {
        const regex = /(^|[^a-zA-Z0-9])(@[^\s*~(`]+)(\([^)]*\))?/gm;

        return text
            .replace(regex, (match, prefix, tagName, _argument, offset, source) => {
                if (isInsideInlineCode(source, offset + prefix.length)) return match;

                const trailingMatch = tagName.match(/[.,;:!?()[\]{}<>"']+$/),
                    trailing = trailingMatch ? trailingMatch[0] : '',
                    name = trailing ? tagName.slice(0, -trailing.length) : tagName;

                if (name === '@') return match;

                const beforeMatch = source.slice(0, offset).trimRight(),
                    punctuation =
                        trailing && beforeMatch.slice(-1) === trailing.charAt(0)
                            ? trailing.slice(1)
                            : trailing;

                return (prefix && /\S/.test(prefix) ? prefix : '') + punctuation;
            })
            .trimRight();
    },
};

/* EXPORT */

export default Tags;
