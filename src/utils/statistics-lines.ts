interface StatisticsLine {
    lineNumber: number;
}

interface StatisticsItems<T extends StatisticsLine> {
    projects?: T[];
    todosBox?: T[];
    todosDone?: T[];
    todosCancelled?: T[];
    comments?: T[];
    tags?: T[];
}

export const getStatisticsScopeEnd = <T>(
    lines: T[],
    startIndex: number,
    scopeLevel: number,
    getLevel: (line: T) => number,
    isTag: (line: T) => boolean,
    includeRemainingDocument = false
): number => {
    if (includeRemainingDocument) return lines.length;

    for (let index = startIndex + 1; index < lines.length; index++) {
        if (!isTag(lines[index]) && getLevel(lines[index]) <= scopeLevel) return index;
    }

    return lines.length;
};

const mergeSorted = <T extends StatisticsLine>(left: T[], right: T[]): T[] => {
    const merged = new Array<T>(left.length + right.length);

    let leftIndex = left.length - 1,
        rightIndex = right.length - 1,
        mergedIndex = merged.length;

    while (mergedIndex) {
        merged[--mergedIndex] =
            rightIndex < 0 ||
            (leftIndex >= 0 && left[leftIndex].lineNumber > right[rightIndex].lineNumber)
                ? left[leftIndex--]
                : right[rightIndex--];
    }

    return merged;
};

export const getStatisticsLines = <T extends StatisticsLine>(items: StatisticsItems<T>): T[] => {
    const groups = [
        items.projects || [],
        items.todosBox || [],
        items.todosDone || [],
        items.todosCancelled || [],
        items.comments || [],
        items.tags || [],
    ];

    return groups.reduce((left, right) => mergeSorted(left, right), []);
};
