import { expect } from 'chai';
import { getCodeBlocks, parseCodeBlocks } from '../src/utils/code-blocks';
import { countPendingTodos } from '../src/utils/activity-bar-badge';
import { getDueTaskLines } from '../src/utils/due_tasks';

describe('Fenced code blocks', () => {
  it('masks complete indented blocks without moving offsets or changing line endings', () => {
    const text = 'Work:\r\n\t``` ts\r\n\t☐ example @id(fake) 😀\r\n\r\n\t```\r\n☐ real';
    const code = parseCodeBlocks(text);
    expect(code.blocks).to.deep.equal([{ startLine: 1, endLine: 4, closed: true }]);
    expect(code.maskedText.length).to.equal(text.length);
    expect(code.maskedText.indexOf('☐ real')).to.equal(text.indexOf('☐ real'));
    expect(code.maskedText.match(/\r\n/g)).to.have.length(5);
    expect(code.maskedText).not.to.contain('fake');
  });

  it('requires a bare closing fence at least as long as its opener', () => {
    const code = parseCodeBlocks('````js\n```\n```sql\n`````\n☐ real\n```unknown\nArchive:');
    expect(code.blocks).to.deep.equal([
      { startLine: 0, endLine: 3, closed: true },
      { startLine: 5, endLine: 6, closed: false },
    ]);
    expect(code.byLine.has(4)).to.equal(false);
  });

  it('does not open blocks from inline backticks or info strings containing backticks', () => {
    const text = '☐ use ```js```\n```js `invalid`\n`inline`';
    expect(parseCodeBlocks(text).blocks).to.deep.equal([]);
    expect(parseCodeBlocks(text).maskedText).to.equal(text);
  });

  it('refreshes cached block state after edits, including edits of equal length', () => {
    let text = '```\n☐ example\n```';
    const document = { version: 1, getText: () => text };
    const first = getCodeBlocks(document);
    expect(getCodeBlocks(document)).to.equal(first);
    text = '---\n☐ example\n---';
    document.version++;
    expect(getCodeBlocks(document).blocks).to.deep.equal([]);
    expect(getCodeBlocks({ getText: () => '```' }).blocks[0].closed).to.equal(false);
  });

  it('ignores task-shaped examples in badges and the Due view', () => {
    const lines = ['```ts', '☐ fake @due(2026-01-01)', '```', '☐ real @due(2026-01-02)'];
    const document = { lineCount: lines.length, lineAt: (line: number) => ({ text: lines[line] }) };
    expect(countPendingTodos({ file: { textEditor: document } }, /^☐ /)).to.equal(1);
    expect(getDueTaskLines(lines, /^☐ /, /^✔ /).map((task) => task.lineNumber)).to.deep.equal([3]);
  });
});
