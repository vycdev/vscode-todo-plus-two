export interface ProjectCopyLine {
    text: string;
    level: number;
}

const renderProjectHeader = (
    header: string,
    statistics: string,
    projectHeaderEnd: number
): string => {
    if (projectHeaderEnd <= 0 || header[projectHeaderEnd - 1] !== ':') return header;

    return `${header.slice(0, projectHeaderEnd)} ${statistics}${header.slice(projectHeaderEnd)}`;
};

export const renderProjectCopy = (
    lines: ProjectCopyLine[],
    projectLine: number,
    statistics: string,
    projectHeaderEnd: number,
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
            index === 0 ? renderProjectHeader(line.text, statistics, projectHeaderEnd) : line.text
        )
        .join(endOfLine);
};
