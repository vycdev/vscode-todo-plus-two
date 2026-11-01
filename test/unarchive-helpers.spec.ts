import { expect } from 'chai';
import { unarchiveItemsFromSameFileContent } from '../src/utils/unarchive-helpers';

const options = {
  indentation: '  ',
  isFinishedTodo: (line: string) => /^\s*✔\s/.test(line),
  isComment: (line: string) => /^\s*-\s/.test(line),
  getProjectName: (line: string) => {
    const match = line.match(/^(\s*)([^:]+):\s*$/);
    return match ? match[2] : undefined;
  },
};

describe('unarchiveItemsFromSameFileContent', () => {
  it('leaves outdented code untouched when restoring a task', () => {
    const content = 'Work:\n\nArchive:\n  Work:\n    ✔ Restore\n    ```python\nprint(1)\n    ```';
    const result = unarchiveItemsFromSameFileContent(content, [4], 2, options);
    expect(result.content).to.contain('  ✔ Restore\n  ```python\nprint(1)\n  ```');
  });
  it('restores complete fenced notes and ignores selections inside them', () => {
    const content = [
      'Work:',
      '  ☐ Existing',
      '',
      'Archive:',
      '  Work:',
      '    ✔ Restore',
      '    ```ts',
      '     code  ',
      '',
      '    ✔ literal',
      '    Work:',
      '    @project(literal)',
      '    ```',
    ].join('\n');
    const result = unarchiveItemsFromSameFileContent(content, [5, 9], 3, options);
    expect(result.count).to.equal(1);
    expect(result.content).to.contain(
      [
        '  ✔ Restore',
        '  ```ts',
        '   code  ',
        '',
        '  ✔ literal',
        '  Work:',
        '  @project(literal)',
        '  ```',
      ].join('\n')
    );
    expect(result.content.split('✔ literal')).to.have.length(2);
  });

  it('does not detach unfinished fenced notes from their task', () => {
    const content = 'Archive:\n  ✔ Restore\n  ```ts\n  code';
    expect(unarchiveItemsFromSameFileContent(content, [1], 0, options)).to.deep.equal({
      content,
      count: 0,
    });
  });
  it('restores a task and its attached comments to the bottom of its original project', () => {
    const content = [
      'Projects:',
      '  Client:',
      '    ☐ Existing task',
      '',
      'Archive:',
      '  Projects:',
      '    Client:',
      '      ✔ Restore build @done(2026-07-08)',
      '',
      '        - Restore this note too',
      '',
    ].join('\n');

    const result = unarchiveItemsFromSameFileContent(content, [7], 4, options);

    expect(result.count).to.equal(1);
    expect(result.content.split('\n')).to.deep.equal([
      'Projects:',
      '  Client:',
      '    ☐ Existing task',
      '    ✔ Restore build @done(2026-07-08)',
      '',
      '      - Restore this note too',
      '',
      'Archive:',
      '  Projects:',
      '    Client:',
      '',
    ]);
  });

  it('recreates a missing project chain before restoring the archived task', () => {
    const content = [
      'Inbox:',
      '  ☐ Existing task',
      '',
      'Archive:',
      '  Work:',
      '    Backend:',
      '      ✔ Restore service @done(2026-07-08)',
      '        - Restore its note',
    ].join('\n');

    const result = unarchiveItemsFromSameFileContent(content, [6], 3, options);

    expect(result.count).to.equal(1);
    expect(result.content.split('\n')).to.deep.equal([
      'Inbox:',
      '  ☐ Existing task',
      'Work:',
      '  Backend:',
      '    ✔ Restore service @done(2026-07-08)',
      '      - Restore its note',
      '',
      'Archive:',
      '  Work:',
      '    Backend:',
    ]);
  });

  it('restores a parent task after a nested project to the parent project', () => {
    const content = [
      'Work:',
      '  Backend:',
      '    ☐ Existing task',
      '',
      'Archive:',
      '  Work:',
      '    Backend:',
      '      ✔ Child task',
      '    ✔ Parent task',
    ].join('\n');

    const result = unarchiveItemsFromSameFileContent(content, [8], 4, options);

    expect(result.count).to.equal(1);
    expect(result.content.split('\n')).to.deep.equal([
      'Work:',
      '  Backend:',
      '    ☐ Existing task',
      '  ✔ Parent task',
      '',
      'Archive:',
      '  Work:',
      '    Backend:',
      '      ✔ Child task',
    ]);
  });

  it('ignores selected finished tasks outside the Archive section', () => {
    const content = ['Todo:', '  ✔ Keep in place', 'Archive:', '  ✔ Restore me'].join('\n');

    const result = unarchiveItemsFromSameFileContent(content, [1, 3], 2, options);

    expect(result.count).to.equal(1);
    expect(result.content.split('\n')).to.deep.equal([
      'Todo:',
      '  ✔ Keep in place',
      '✔ Restore me',
      'Archive:',
    ]);
  });
});
