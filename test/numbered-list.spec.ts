import { expect } from 'chai';
import { getNumberedListEnterEdits } from '../src/utils/numbered-list';

const enter = (text: string, line: number, eol = '\n') => {
  const lines = text.split(eol);
  const edits = getNumberedListEnterEdits(line, (index) => lines[index], eol)!;
  edits
    .slice()
    .reverse()
    .forEach(({ line, start, end, text }) => {
      lines[line] = lines[line].slice(0, start) + text + lines[line].slice(end);
    });
  return lines.join(eol);
};

describe('Numbered list continuation', () => {
  it('inserts an item and renumbers its following siblings without changing another module', () => {
    const original = [
      'Module One:',
      '1. Old todo 1',
      '2. Old todo 2 @id(task2)',
      '3. Another one @depends(task2)',
      '',
      'Module Two:',
      '1. This is module todo',
      '2. Another todo of module two',
    ];
    const expected = original.slice();
    expected.splice(2, 2, '2. ', '3. Old todo 2 @id(task2)', '4. Another one @depends(task2)');

    expect(enter(original.join('\n'), 1)).to.equal(expected.join('\n'));
  });

  it('normalizes gaps after the inserted item', () => {
    expect(enter('1. First\n3. Third\n8. Eighth', 0)).to.equal(
      '1. First\n2. \n3. Third\n4. Eighth'
    );
  });

  it('preserves a non-1 start and handles a change in number width', () => {
    expect(enter('8. Eighth\n9. Ninth\n10. Tenth', 1)).to.equal(
      '8. Eighth\n9. Ninth\n10. \n11. Tenth'
    );
  });

  it('changes only the digits of following items', () => {
    expect(enter('  7. First  \n  42.\tSecond  @id(42)\n  5.   Version 1.2', 0)).to.equal(
      '  7. First  \n  8. \n  9.\tSecond  @id(42)\n  10.   Version 1.2'
    );
  });

  it('preserves tabs and spacing after the dot', () => {
    expect(enter('\t1.\tFirst\n\t2.\tSecond', 0)).to.equal('\t1.\tFirst\n\t2.\t\n\t3.\tSecond');
  });

  ['', 'Project:', 'Unnumbered note'].forEach((boundary) => {
    it(`stops at the boundary ${JSON.stringify(boundary)}`, () => {
      const ending = `\n${boundary}\n9. Unrelated`;
      expect(enter('1. First\n2. Second' + ending, 0)).to.equal(
        '1. First\n2. \n3. Second' + ending
      );
    });
  });

  it('stops at a dedent without renumbering a parent list', () => {
    expect(enter('  1. Child\n2. Parent', 0)).to.equal('  1. Child\n  2. \n2. Parent');
  });

  it('renumbers following siblings past nested numbered children', () => {
    expect(enter('1. Parent\n  1. Child\n  2. Child\n2. Sibling\n3. Last', 0)).to.equal(
      '1. Parent\n2. \n  1. Child\n  2. Child\n3. Sibling\n4. Last'
    );
  });

  ['  ☐ Subtask', '  Some note', '  - Detail', '  1. Child\n    Child note'].forEach((nested) => {
    it(`renumbers following siblings past nested ${JSON.stringify(nested)}`, () => {
      expect(enter(`1. Parent\n${nested}\n2. Sibling`, 0)).to.equal(
        `1. Parent\n2. \n${nested}\n3. Sibling`
      );
    });
  });

  it('does not treat a differently indented line as nested', () => {
    expect(enter('  1. Parent\n\tTab note\n  2. Sibling', 0)).to.equal(
      '  1. Parent\n  2. \n\tTab note\n  2. Sibling'
    );
  });

  ['\n', '\r\n'].forEach((eol) => {
    it(`preserves ${JSON.stringify(eol)} line endings when continuing the last item`, () => {
      expect(enter(`Project:${eol}  5. Last item`, 1, eol)).to.equal(
        `Project:${eol}  5. Last item${eol}  6. `
      );
    });
  });

  it('exits an empty item while preserving its indentation', () => {
    expect(enter('  1. First\n  2.   \n  3. Following', 1)).to.equal(
      '  1. First\n  \n  3. Following'
    );
  });

  it('ignores non-list syntax and numbers outside the supported range', () => {
    ['Project:', '1.5 decimal', '0. Zero', '01. Padded', '1) Parenthesis', '☐ 1. Todo'].forEach(
      (text) =>
        expect(
          getNumberedListEnterEdits(0, () => text, '\n'),
          text
        ).to.equal(undefined)
    );
    expect(
      getNumberedListEnterEdits(0, (line) => ['9007199254740991. Maximum'][line], '\n')
    ).to.equal(undefined);
  });

  it('does not partially renumber a list that would overflow', () => {
    const lines = ['9007199254740990. First', '1. Second'];
    expect(getNumberedListEnterEdits(0, (line) => lines[line], '\n')).to.equal(undefined);
  });

  it('reads only the current item and the affected list', () => {
    const lines = ['1. First', '2. Second', '', '3. Unrelated'];
    const read: number[] = [];
    getNumberedListEnterEdits(
      0,
      (line) => {
        read.push(line);
        return lines[line];
      },
      '\n'
    );
    expect(read).to.deep.equal([0, 1, 2]);
  });
});
