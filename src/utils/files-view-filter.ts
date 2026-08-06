const makeFilter = (filter: string) =>
    new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

const matchesFilesViewFilter = (
    filter: string | false,
    filePath: string,
    branchLines: string[]
): boolean => {
    if (!filter) return true;

    const filterRe = makeFilter(filter);

    return filterRe.test(filePath) || branchLines.some((line) => filterRe.test(line));
};

const hasUnfinishedTodo = (
    lines: string[],
    todoPattern: RegExp,
    finishedTodoPattern: RegExp
): boolean => lines.some((line) => !!line.match(todoPattern) && !line.match(finishedTodoPattern));

export { hasUnfinishedTodo, matchesFilesViewFilter };
