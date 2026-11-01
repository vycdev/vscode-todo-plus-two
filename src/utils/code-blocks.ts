export interface CodeBlock {
  startLine: number;
  endLine: number;
  closed: boolean;
}

export interface CodeBlockContext {
  blocks: CodeBlock[];
  byLine: Map<number, CodeBlock>;
  maskedText: string;
}

interface CodeBlockDocument {
  version?: number;
  getText?(): string;
  lineCount?: number;
  lineAt?(lineNumber: number): { text: string };
}

const cache = new WeakMap<
  CodeBlockDocument,
  { version?: number; text: string; context: CodeBlockContext }
>();

// Keep these rules in sync with scripts/generate-code-grammar.js.
// Todo allows fences at any indentation. A closing fence has no info string and
// at least as many backticks as its opener; an unfinished block extends to EOF.
export const parseCodeBlocks = (text: string): CodeBlockContext => {
  const context: CodeBlockContext = { blocks: [], byLine: new Map(), maskedText: text };
  if (text.indexOf('```') < 0) return context;

  const lines = text.split('\n');
  let opening: { line: number; length: number } | undefined;

  const addBlock = (endLine: number, closed: boolean) => {
    const block = { startLine: opening.line, endLine, closed };
    context.blocks.push(block);
    for (let line = block.startLine; line <= endLine; line++) context.byLine.set(line, block);
    opening = undefined;
  };

  lines.forEach((line, lineNumber) => {
    if (opening) {
      const closing = /^[\t ]*(`{3,})[\t ]*\r?$/.exec(line);
      if (closing && closing[1].length >= opening.length) addBlock(lineNumber, true);
    } else {
      const match = /^[\t ]*(`{3,})[^`\r\n]*\r?$/.exec(line);
      if (match) opening = { line: lineNumber, length: match[1].length };
    }
  });
  if (opening) addBlock(lines.length - 1, false);

  context.maskedText = lines
    .map((line, index) => (context.byLine.has(index) ? line.replace(/[^\r]/g, ' ') : line))
    .join('\n');
  return context;
};

export const getCodeBlocks = (document: CodeBlockDocument): CodeBlockContext => {
  const previous = cache.get(document);
  if (previous && typeof document.version === 'number' && previous.version === document.version) {
    return previous.context;
  }

  const text = document.getText
    ? document.getText()
    : Array.from({ length: document.lineCount }, (_, line) => document.lineAt(line).text).join(
        '\n'
      );
  if (previous && previous.text === text) {
    previous.version = document.version;
    return previous.context;
  }
  const context = parseCodeBlocks(text);
  cache.set(document, { version: document.version, text, context });
  return context;
};

// Shift only the task's shared indentation prefix. Code's own indentation,
// trailing whitespace and empty lines are literal, including mixed tabs/spaces.
export const shiftCodeIndentation = (
  line: string,
  sourcePrefix: string,
  targetPrefix: string
): string => {
  return line.startsWith(sourcePrefix) ? targetPrefix + line.slice(sourcePrefix.length) : line;
};
