/* TAGS */

function escapeRegExp(str: string) {
    return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
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
                .join('|')})(?:(?:\\([^)]*\\))|(?![a-zA-Z]))`,
            'g'
        );

        return text
            .replace(regex, (match, prefix) => (prefix && /\S/.test(prefix) ? prefix : ''))
            .trimRight();
    },

    removeAll(text: string) {
        const regex = /(^|[^a-zA-Z0-9`])(@[^\s*~(`]+)(\([^)]*\))?/gm;

        return text
            .replace(regex, (match, prefix, tagName, _argument, offset, source) => {
                const codeMarkers = source.slice(0, offset).match(/`/g);

                if (codeMarkers && codeMarkers.length % 2) return match;

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
