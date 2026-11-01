export interface FoldingLineRange {
  end: number;
  kind?: 'region';
  start: number;
}

const getRegionRanges = (lines: string[]): FoldingLineRange[] => {
  const starts: number[] = [];
  const ranges: FoldingLineRange[] = [];

  lines.forEach((line, lineNumber) => {
    if (/^\s*@region\s*$/.test(line)) {
      starts.push(lineNumber);
    } else if (/^\s*@endregion\s*$/.test(line) && starts.length) {
      ranges.push({ start: starts.pop(), end: lineNumber, kind: 'region' });
    }
  });

  return ranges;
};

export const getIndentationWidth = (line: string, tabSize: number) => {
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
  const regions = getRegionRanges(lines);

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

    if (end <= start) return;

    // Native folds must be nested or disjoint. Explicit regions win when a
    // project only partially overlaps them, including a shared boundary line.
    const crossesRegion = regions.some((region) => {
      const overlaps = start <= region.end && region.start <= end;
      const containsRegion = start <= region.start && region.end <= end;
      const insideRegion = region.start <= start && end <= region.end;

      return overlaps && !containsRegion && !insideRegion;
    });

    if (!crossesRegion) ranges.push({ start, end });
  });

  return ranges.concat(regions).sort((a, b) => a.start - b.start);
};
