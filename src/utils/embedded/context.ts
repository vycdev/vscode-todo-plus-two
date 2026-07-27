export const getFollowingContext = (
    lines: string[],
    lineNr: number,
    isEmbeddedTodo: (line: string) => boolean
): string | undefined => {
    const line = lines[lineNr + 1];

    if (line === undefined) return;

    const context = line.trim();

    if (!context || isEmbeddedTodo(context)) return;

    return context;
};
