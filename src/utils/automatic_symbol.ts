interface AutomaticSymbolRule {
    beforeText: RegExp;
    afterText: RegExp;
    appendText: string;
}

interface TodoSymbols {
    box: string;
    done: string;
    cancelled: string;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getAutomaticSymbolRule = (symbols: TodoSymbols): AutomaticSymbolRule | undefined => {
    if (!symbols.box) return;

    const configuredSymbols = [symbols.box, symbols.done, symbols.cancelled]
        .filter(Boolean)
        .map(escapeRegExp);
    const defaultSymbols = ['☐', '✔', '✘'].map(escapeRegExp);
    const symbolPattern = configuredSymbols.concat(defaultSymbols).filter((symbol, index, all) => {
        return all.indexOf(symbol) === index;
    });
    const todoPattern = symbolPattern.concat(['-\\s+\\[[ xX]\\]']).join('|');

    return {
        beforeText: new RegExp('^\\s*(?!--|––|——)(?:' + todoPattern + ')\\s+\\S(?:.*\\S)?\\s*$'),
        afterText: /^\s*$/,
        appendText: symbols.box + ' ',
    };
};

export { AutomaticSymbolRule, TodoSymbols, getAutomaticSymbolRule };
