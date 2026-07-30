export type AutoCompleteStatus = 'box' | 'done' | 'cancelled' | 'other';

export interface AutoCompleteLine {
    lineNumber: number;
    level: number;
    status?: AutoCompleteStatus;
    isProject?: boolean;
}

export const getAutoCompletableParentLines = (
    lines: AutoCompleteLine[],
    completedLines: number[],
    blockedLines: number[] = []
): number[] => {
    const lineIndexes = new Map<number, number>(
            lines.map((line, index): [number, number] => [line.lineNumber, index])
        ),
        candidates = new Map<number, AutoCompleteLine>();

    completedLines.forEach((lineNumber) => {
        const startIndex = lineIndexes.get(lineNumber);
        if (startIndex === undefined || lines[startIndex].status !== 'done') return;

        let childLevel = lines[startIndex].level;

        for (let index = startIndex - 1; index >= 0; index--) {
            const line = lines[index];
            if (line.isProject) break;
            if (line.level >= childLevel) continue;

            childLevel = line.level;
            if (line.status === 'box') candidates.set(line.lineNumber, line);
        }
    });

    const blocked = new Set(blockedLines),
        done = new Set(
            lines.filter((line) => line.status === 'done').map((line) => line.lineNumber)
        ),
        result: number[] = [];

    Array.from(candidates.values())
        .sort((left, right) => right.level - left.level || right.lineNumber - left.lineNumber)
        .forEach((candidate) => {
            if (blocked.has(candidate.lineNumber)) return;

            const startIndex = lineIndexes.get(candidate.lineNumber),
                descendants: AutoCompleteLine[] = [];

            for (let index = startIndex + 1; index < lines.length; index++) {
                const line = lines[index];
                if (line.level <= candidate.level) break;
                if (line.isProject) break;
                if (line.status) descendants.push(line);
            }

            if (!descendants.length || descendants.some((line) => !done.has(line.lineNumber))) {
                return;
            }

            done.add(candidate.lineNumber);
            result.push(candidate.lineNumber);
        });

    return result;
};
