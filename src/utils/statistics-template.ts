const timeTokens = new Set(['est', 'est-total', 'est-finished', 'lasted', 'wasted', 'elapsed']);

const tokenRegexes: { [token: string]: RegExp } = {};

const getTokenRegex = (token: string): RegExp => {
    if (!tokenRegexes[token]) {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        tokenRegexes[token] = new RegExp(`\\[${escapedToken}\\]`, 'g');
    }

    return tokenRegexes[token];
};

export const renderStatisticsTemplate = (
    template: string,
    tokens: { [token: string]: any },
    supportedTokens: string[]
): string => {
    for (const token of supportedTokens) {
        const regex = getTokenRegex(token);

        if (!regex.test(template)) continue;

        let value = tokens[token];

        if (timeTokens.has(token) && value === '') value = '0s';

        template = template.replace(regex, value);
    }

    return template;
};
