export interface FoldingLineRange {
    end: number;
    start: number;
}

const getIndentationWidth = (line: string, tabSize: number) => {
    const indentation = line.match(/^\s*/)[0];

    return indentation.split('').reduce((width, character) => {
        if (character !== '\t') return width + 1;

        return width + tabSize - (width % tabSize);
    }, 0);
};

export const getFoldingRanges = (
    lines: string[],
    isFoldStart: (line: string) => boolean,
    tabSize: number = 4
): FoldingLineRange[] => {
    const ranges: FoldingLineRange[] = [];

    lines.forEach((line, start) => {
        if (!isFoldStart(line)) return;

        const startIndentation = getIndentationWidth(line, tabSize);
        let end = start;

        for (let lineNumber = start + 1; lineNumber < lines.length; lineNumber++) {
            const candidate = lines[lineNumber];

            if (!candidate.trim()) continue;
            if (getIndentationWidth(candidate, tabSize) <= startIndentation) break;

            end = lineNumber;
        }

        if (end > start) ranges.push({ start, end });
    });

    return ranges;
};
