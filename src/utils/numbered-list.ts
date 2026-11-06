interface NumberedListReplacement {
  line: number;
  start: number;
  end: number;
  text: string;
}

const numberedItem = /^([ \t]*)([1-9]\d*)\.([ \t]+)(.*)$/;

const getNumberedListEnterEdits = (
  lineNumber: number,
  getLine: (line: number) => string | undefined,
  eol: string
): NumberedListReplacement[] | undefined => {
  const text = getLine(lineNumber);
  if (text === undefined) return;

  const item = numberedItem.exec(text);
  if (!item) return;

  const [, indentation, digits, spacing, content] = item;
  let nextNumber = Number(digits) + 1;
  if (!Number.isSafeInteger(nextNumber)) return;

  if (!content.trim()) {
    return [{ line: lineNumber, start: indentation.length, end: text.length, text: '' }];
  }

  const prefix = `${indentation}${nextNumber}.${spacing}`;
  const replacements: NumberedListReplacement[] = [
    { line: lineNumber, start: text.length, end: text.length, text: eol + prefix },
  ];

  for (let line = lineNumber + 1; ; line++) {
    const following = getLine(line);
    if (following === undefined) break;

    // Deeper lines (nested items, tasks and notes) belong to the preceding item.
    // Skip them and resume at the next sibling at our indentation.
    const leading = /^[ \t]*/.exec(following)[0];
    if (following.trim() && leading.startsWith(indentation) && leading.length > indentation.length)
      continue;

    const sibling = numberedItem.exec(following);
    if (!sibling || sibling[1] !== indentation) break;

    nextNumber++;
    if (!Number.isSafeInteger(nextNumber)) return;

    if (sibling[2] !== String(nextNumber)) {
      replacements.push({
        line,
        start: indentation.length,
        end: indentation.length + sibling[2].length,
        text: String(nextNumber),
      });
    }
  }

  return replacements;
};

export { getNumberedListEnterEdits };
