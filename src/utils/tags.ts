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
};

/* EXPORT */

export default Tags;
