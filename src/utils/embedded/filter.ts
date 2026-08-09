export const matchesEmbeddedFilter = (
    filterRe: RegExp | false,
    filePath: string,
    line: string,
    context?: string
): boolean => {
    if (!filterRe) return true;

    return filterRe.test(filePath) || filterRe.test(line) || (!!context && filterRe.test(context));
};
