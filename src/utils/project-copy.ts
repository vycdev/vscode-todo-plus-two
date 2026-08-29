export interface ProjectCopyLine {
    text: string;
    level: number;
}

const renderProjectHeader = (header: string, statistics: string): string => {
    const match = header.match(/^(\s*)(.+):(.*)$/);

    if (!match) return header;

    return `${match[1]}${match[2]}: ${statistics}${match[3]}`;
};

export const renderProjectCopy = (
    lines: ProjectCopyLine[],
    projectLine: number,
    statistics: string,
    endOfLine = '\n',
    includeRemainingDocument = false
): string => {
    if (!lines[projectLine]) return '';

    const projectLevel = lines[projectLine].level;
    let end = lines.length;

    if (!includeRemainingDocument) {
        for (let index = projectLine + 1; index < lines.length; index++) {
            if (lines[index].text.trim() && lines[index].level <= projectLevel) {
                end = index;
                break;
            }
        }
    }

    while (end > projectLine + 1 && !lines[end - 1].text.trim()) end--;

    return lines
        .slice(projectLine, end)
        .map((line, index) =>
            index === 0 ? renderProjectHeader(line.text, statistics) : line.text
        )
        .join(endOfLine);
};
