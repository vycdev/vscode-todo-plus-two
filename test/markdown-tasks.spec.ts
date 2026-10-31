import { expect } from 'chai';
import { parseMarkdownTasks, replaceMarkdownTaskMarker } from '../src/utils/markdown-tasks';
import {
  collectMarkdownArchiveBlocks,
  insertMarkdownArchiveBlocks,
  removeMarkdownArchiveBlocks,
} from '../src/utils/markdown-archive';

describe('Markdown task sources', () => {
  it('extracts the issue #256 example with heading and Todo+ project hierarchy', () => {
    const content = [
      '# Big task name',
      '',
      'Some task description.',
      '',
      '## Todos',
      '',
      '[ ] Simple task.',
      '',
      'Big activity:',
      '  [ ] Another task related to that activity.',
      '',
      '## Notes',
      '',
      '### Call with Bob',
      '',
      'Some notes about call with Bob.',
      '',
      '### Architecture',
      '',
      'Here will be a mermaid diagram, for example.',
      '',
      '[ ] Some task for architecture.',
    ].join('\n');
    const nodes = parseMarkdownTasks(content);
    expect(
      nodes
        .filter((node) => node.kind === 'todo')
        .map((node) => [node.lineNumber, node.parent, node.title])
    ).to.deep.equal([
      [6, 4, 'Simple task.'],
      [9, 8, 'Another task related to that activity.'],
      [21, 17, 'Some task for architecture.'],
    ]);
    expect(nodes.filter((node) => node.kind === 'project').map((node) => node.title)).to.deep.equal(
      ['Big task name', 'Todos', 'Big activity', 'Notes', 'Architecture']
    );
  });

  it('recognizes native list styles, bare checkboxes, Unicode and configured symbols', () => {
    const lines = [
      '- [ ] One',
      '* [x] Two',
      '+ [X] Three',
      '1. [ ] Four',
      '2) [ ] Five',
      '[ ] Six',
      '☐ Seven',
      '✔ Eight',
      '✘ Nine',
      'OPEN Ten',
      '- [ ] Eleven @cancelled',
      '[ ] Twelve `@done`',
    ];
    const nodes = parseMarkdownTasks(lines.join('\n'), { symbols: { box: 'OPEN' } });
    expect(nodes.map((node) => node.status)).to.deep.equal([
      'box',
      'done',
      'done',
      'box',
      'box',
      'box',
      'box',
      'done',
      'cancelled',
      'box',
      'cancelled',
      'box',
    ]);
  });

  it('preserves list prefixes, indentation, tags and child blocks when completing tasks', () => {
    const content = '  12. [ ] Parent @id(parent)\n      - [ ] Child\n        Details';
    const node = parseMarkdownTasks(content)[0];
    expect(replaceMarkdownTaskMarker(content.split('\n')[0], node, 'done')).to.equal(
      '  12. [x] Parent @id(parent)'
    );
    expect(node.endLine).to.equal(3);
    expect(parseMarkdownTasks(content)[1].parent).to.equal(0);
  });

  it('excludes examples in fences, indented code, quotes, front matter, and comments', () => {
    const content = [
      '---',
      'title: example',
      '[ ] Metadata',
      '---',
      '',
      '```markdown',
      '# Fake heading',
      '- [ ] Example',
      '```',
      '~~~',
      '[ ] Example two',
      '~~~',
      '',
      '    - [ ] Indented example',
      '',
      '> - [ ] Quoted example',
      '<!--',
      '[ ] Comment',
      '-->',
      '',
      '- [ ] Real',
      '      - [ ] Nested code example',
      '  - [ ] Child',
    ].join('\n');
    expect(
      parseMarkdownTasks(content)
        .filter((node) => node.kind === 'todo')
        .map((node) => node.title)
    ).to.deep.equal(['Real', 'Child']);
  });

  it('handles nested fences and an unfinished fence without exposing task examples', () => {
    const content = '````\n```\n[ ] Example\n```\n````\n[ ] Real\n~~~\n[ ] Unfinished example';
    expect(parseMarkdownTasks(content).map((node) => node.title)).to.deep.equal(['Real']);
  });

  it('limits section scope to complete heading subtrees, case insensitively', () => {
    const content =
      '# Note\n[ ] Outside\n## tOdOs\n[ ] Inside\n### Nested\n[ ] Nested task\n## Notes\n[ ] Outside again';
    const tasks = parseMarkdownTasks(content, { scope: 'sections' }).filter(
      (node) => node.kind === 'todo'
    );
    expect(tasks.map((node) => node.title)).to.deep.equal(['Inside', 'Nested task']);
  });

  it('keeps repeated heading names and sibling project paths distinct', () => {
    const nodes = parseMarkdownTasks('# A\n## Tasks\n- [ ] First\n# B\n## Tasks\n- [ ] Second');
    expect(nodes.filter((node) => node.kind === 'todo').map((node) => node.parent)).to.deep.equal([
      1, 4,
    ]);
  });

  it('recognizes Setext task sections and bounds them at the next peer heading', () => {
    const content = 'Note\n====\n\nTodos\n-----\n[ ] Inside\n\nNotes\n-----\n[ ] Outside';
    expect(
      parseMarkdownTasks(content, { scope: 'sections' })
        .filter((node) => node.kind === 'todo')
        .map((node) => node.title)
    ).to.deep.equal(['Inside']);
  });

  it('excludes indented code under ordinary list groups', () => {
    const content = '- Group\n      [ ] Code example\n  - [ ] Actual child';
    expect(
      parseMarkdownTasks(content)
        .filter((node) => node.kind === 'todo')
        .map((node) => node.title)
    ).to.deep.equal(['Actual child']);
  });
});

describe('Markdown archive round trips', () => {
  it('keeps an attached fenced block intact even when its content is dedented', () => {
    const content = '- [x] Task\n  ```text\n[ ] Example\n  ```\n\nKeep prose.';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    expect(blocks[0].lines).to.deep.equal(['- [x] Task', '  ```text', '[ ] Example', '  ```']);
    expect(removeMarkdownArchiveBlocks(content, blocks)).to.equal('\nKeep prose.');
  });
  it('moves finished blocks with notes and restores them under existing headings', () => {
    const content =
      '# Note\n\nKeep this prose.\n\n## Todos\n\n- [x] Finished @id(one)\n  Attached note\n\n- [ ] Pending\n\n## Notes\n\nKeep these notes.\n';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    expect(blocks).to.have.length(1);
    const source = removeMarkdownArchiveBlocks(content, blocks);
    const archived = insertMarkdownArchiveBlocks(source, blocks, {});
    expect(archived).to.include('Keep these notes.');
    expect(archived).to.include(
      '# Archive\nNote:\n  Todos:\n    - [x] Finished @id(one)\n      Attached note'
    );
    const task = parseMarkdownTasks(archived).find(
      (node) => node.kind === 'todo' && node.inArchive
    );
    const restoring = collectMarkdownArchiveBlocks(archived, {}, [task.lineNumber], true);
    const restored = insertMarkdownArchiveBlocks(
      removeMarkdownArchiveBlocks(archived, restoring),
      restoring,
      {},
      false
    );
    const restoredTasks = parseMarkdownTasks(restored).filter((node) => node.kind === 'todo');
    expect(restoredTasks.filter((node) => node.inArchive)).to.have.length(0);
    expect(restoredTasks.filter((node) => !node.inArchive)).to.have.length(2);
    expect(restored).to.include('- [x] Finished @id(one)\n  Attached note');
    expect(restored.match(/## Todos/g)).to.have.length(1);
  });

  it('retains an unfinished child in the source when its parent is finished', () => {
    const content = '# Tasks\n- [x] Parent\n  - [ ] Pending child\n  - [x] Finished child';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    expect(blocks.map((block) => block.start)).to.deep.equal([3]);
    const archived = insertMarkdownArchiveBlocks(
      removeMarkdownArchiveBlocks(content, blocks),
      blocks,
      {}
    );
    const selected = parseMarkdownTasks(archived).find(
      (node) => node.kind === 'todo' && node.inArchive
    );
    const restoring = collectMarkdownArchiveBlocks(archived, {}, [selected.lineNumber], true);
    const restored = insertMarkdownArchiveBlocks(
      removeMarkdownArchiveBlocks(archived, restoring),
      restoring,
      {},
      false
    );
    const child = parseMarkdownTasks(restored).find(
      (node) => node.title === 'Finished child' && node.kind === 'todo'
    );
    expect(child.parent).to.equal(1);
  });

  it('moves a complete finished subtree once and preserves CRLF and task order', () => {
    const content = '# Tasks\r\n- [x] Parent\r\n  - [x] Child\r\n\r\n- [x] Sibling\r\n';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    expect(blocks).to.have.length(2);
    const archive = insertMarkdownArchiveBlocks('', blocks, {}, true, '\r\n');
    expect(archive).to.include('- [x] Parent\r\n    - [x] Child');
    expect(archive.indexOf('Parent')).to.be.lessThan(archive.indexOf('Sibling'));
    expect(archive.replace(/\r\n/g, '')).not.to.include('\n');
  });
});
