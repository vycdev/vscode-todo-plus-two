import { expect } from 'chai';
import { parseMarkdownTasks, replaceMarkdownTaskMarker } from '../src/utils/markdown-tasks';
import {
  collectMarkdownArchiveBlocks,
  insertMarkdownArchiveBlocks,
  removeMarkdownArchiveBlocks,
} from '../src/utils/markdown-archive';

describe('Markdown task sources', () => {
  it('does not let an HTML comment inside a block quote hide later tasks', () => {
    const content = '> <!-- Unfinished quoted example\n> [ ] Quoted\n\n[ ] Real';
    expect(
      parseMarkdownTasks(content)
        .filter((node) => node.kind === 'todo')
        .map((node) => node.title)
    ).to.deep.equal(['Real']);
  });

  it('ignores fences opened directly after a list marker without hiding later tasks', () => {
    for (const content of [
      '- ```markdown\n  [ ] Example\n  ```\n- [ ] Real',
      '12. ~~~\n    [ ] Example\n    ~~~\n[ ] Real',
      '- [ ] Parent\n  - ```\n    [ ] Example\n    ```\n  - [ ] Real',
    ]) {
      expect(
        parseMarkdownTasks(content)
          .filter((node) => node.kind === 'todo')
          .map((node) => node.title)
      ).to.deep.equal(content.includes('Parent') ? ['Parent', 'Real'] : ['Real']);
    }
  });

  it('honors Markdown backslash escapes before status tags and comment delimiters', () => {
    expect(parseMarkdownTasks('[ ] Literal \\@done')[0].status).to.equal('box');
    expect(parseMarkdownTasks('[ ] Real \\\\@done')[0].status).to.equal('done');
    expect(parseMarkdownTasks('[ ] Literal \\\\\\@done')[0].status).to.equal('box');
    expect(parseMarkdownTasks('[ ] Real \\<!-- @done')[0].status).to.equal('done');
  });

  it('does not treat escaped backticks as code delimiters', () => {
    expect(parseMarkdownTasks('[ ] Real \\`@done\\`')[0].status).to.equal('done');
  });
  it('does not let a backtick inside a comment hide its actual closing delimiter', () => {
    const node = parseMarkdownTasks('[ ] Task <!-- ` --> literal` @done')[0];
    expect(node.status).to.equal('done');
  });
  it('keeps custom bracketed symbols distinct from Markdown checkboxes', () => {
    const symbols = { box: '[todo]', done: '[done]' };
    const node = parseMarkdownTasks('[todo] Task', { symbols })[0];
    expect(node.style).to.equal('symbol');
    expect(replaceMarkdownTaskMarker('[todo] Task', node, 'done', symbols)).to.equal('[done] Task');
  });

  it('scopes Setext headings inside nested lists to their owning task', () => {
    const content =
      '- [ ] Parent\n  - [ ] Child\n    Part\n    ----\n    - [ ] Grandchild\n- [ ] Sibling';
    const nodes = parseMarkdownTasks(content);
    expect(nodes.map((node) => [node.lineNumber, node.parent])).to.deep.equal([
      [0, undefined],
      [1, 0],
      [2, 1],
      [4, 2],
      [5, undefined],
    ]);
  });
  it('keeps headings inside list items scoped to their owning item', () => {
    const content =
      '# Note\n- [ ] Parent\n  ## Part\n  - [ ] Child\n    ### Detail\n    - [ ] Grandchild\n- [ ] Sibling';
    const nodes = parseMarkdownTasks(content);
    expect(nodes.map((node) => [node.lineNumber, node.parent])).to.deep.equal([
      [0, undefined],
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 0],
    ]);
  });
  it('does not let fence-looking indented code hide subsequent tasks', () => {
    for (const content of [
      '    ```\n\n[ ] Real',
      '- Group\n      ```\n\n[ ] Real',
      '    <!--\n\n[ ] Real',
    ]) {
      expect(
        parseMarkdownTasks(content)
          .filter((node) => node.kind === 'todo')
          .map((node) => node.title)
      ).to.deep.equal(['Real']);
    }
  });

  it('keeps an indented closing-fence example inside its enclosing fence', () => {
    const content = '```\n    ```\n[ ] Still code\n```\n[ ] Real';
    expect(
      parseMarkdownTasks(content)
        .filter((node) => node.kind === 'todo')
        .map((node) => node.title)
    ).to.deep.equal(['Real']);
  });

  it('recognizes multiline comments opened after prose while preserving literal code examples', () => {
    const content =
      'Some prose <!--\n[ ] Hidden\n--> <!--\n[ ] Also hidden\n-->\n`<!--`\n[ ] Real <!-- @done -->';
    const tasks = parseMarkdownTasks(content).filter((node) => node.kind === 'todo');
    expect(tasks.map((node) => node.title)).to.deep.equal(['Real <!-- @done -->']);
    expect(tasks[0].status).to.equal('box');
  });
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
  it('recognizes custom archive names containing trailing heading markers', () => {
    for (const archiveName of ['History #', 'History ###', '**History**']) {
      const options = { archiveName };
      const blocks = collectMarkdownArchiveBlocks('[x] Done', options);
      const archive = insertMarkdownArchiveBlocks('', blocks, options);
      const tasks = parseMarkdownTasks(archive, options).filter((node) => node.kind === 'todo');
      expect(
        tasks.map((node) => node.inArchive),
        archiveName
      ).to.deep.equal([true]);
      const restoring = collectMarkdownArchiveBlocks(archive, options, [tasks[0].lineNumber], true);
      expect(restoring, archiveName).to.have.length(1);
    }
    expect(
      parseMarkdownTasks('# **History**\n[ ] Task', {
        scope: 'sections',
        sections: ['**History**'],
      }).filter((node) => node.kind === 'todo')
    ).to.have.length(1);
  });

  it('recreates missing parent headings whose names end with heading markers', () => {
    for (const prefix of ['', '# Group\n', '##### Group\n']) {
      const blocks = collectMarkdownArchiveBlocks(`${prefix}- [ ] Parent #\n  - [x] Child`, {});
      const archive = insertMarkdownArchiveBlocks(prefix, blocks, {});
      const task = parseMarkdownTasks(archive).find((node) => node.kind === 'todo');
      const restoring = collectMarkdownArchiveBlocks(archive, {}, [task.lineNumber], true);
      const restored = insertMarkdownArchiveBlocks(
        removeMarkdownArchiveBlocks(archive, restoring),
        restoring,
        {},
        false
      );
      const nodes = parseMarkdownTasks(restored);
      const child = nodes.find((node) => node.kind === 'todo');
      const parent = nodes.find((node) => node.lineNumber === child.parent);
      expect(child.inArchive).to.equal(false);
      expect(parent.title).to.equal('Parent #');
      expect(parent.heading).to.equal(prefix ? prefix.indexOf(' ') + 1 : 1);
    }
  });

  it('safely serializes project titles that resemble tasks, headings, fences, or comments', () => {
    for (const title of [
      '[ ] Milestone',
      '``` Examples',
      '## Notes',
      '**Literal**',
      '<!-- Label -->',
      '☐ Team',
      'a\\b:*label',
    ]) {
      const original = `# ${title}\n- [x] Finished\n`;
      const blocks = collectMarkdownArchiveBlocks(original, {});
      const archived = insertMarkdownArchiveBlocks(
        removeMarkdownArchiveBlocks(original, blocks),
        blocks,
        {}
      );
      const tasks = parseMarkdownTasks(archived).filter((node) => node.kind === 'todo');
      expect(
        tasks.map((node) => [node.title, node.status, node.inArchive]),
        title
      ).to.deep.equal([['Finished', 'done', true]]);
      const restoring = collectMarkdownArchiveBlocks(archived, {}, [tasks[0].lineNumber], true);
      const restored = insertMarkdownArchiveBlocks(
        removeMarkdownArchiveBlocks(archived, restoring),
        restoring,
        {},
        false
      );
      expect(
        parseMarkdownTasks(restored).find((node) => node.kind === 'todo' && !node.inArchive).parent,
        title
      ).to.equal(0);
    }
  });

  it('rejects archive destinations that hide inserted tasks in unfinished code blocks', () => {
    for (const source of ['[x] Done', '# Tasks\n[x] Done']) {
      const blocks = collectMarkdownArchiveBlocks(source, {});
      for (const archive of ['# Archive\n```\nUnfinished example', '```\nUnfinished example']) {
        expect(() => insertMarkdownArchiveBlocks(archive, blocks, {})).to.throw(
          'Source tasks were kept'
        );
      }
    }
  });
  it('restores a task below an existing heading inside a list item', () => {
    const content = '# Tasks\n- [ ] Parent\n  ## Part\n  - [x] Child\n- [ ] Sibling';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    const archived = insertMarkdownArchiveBlocks(
      removeMarkdownArchiveBlocks(content, blocks),
      blocks,
      {}
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
    const child = parseMarkdownTasks(restored).find(
      (node) => node.kind === 'todo' && node.title === 'Child'
    );
    expect(child.parent).to.equal(2);
    expect(restored).to.include('  ## Part\n  - [x] Child\n- [ ] Sibling');
  });
  it('moves an inline multiline comment as one attached block', () => {
    const content = '[x] Done <!--\nHidden note\n-->\n\nKeep prose.';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    expect(blocks[0].lines).to.deep.equal(['[x] Done <!--', 'Hidden note', '-->']);
    expect(removeMarkdownArchiveBlocks(content, blocks)).to.equal('\nKeep prose.');
  });

  it('recreates missing section headings so unarchived tasks remain discoverable', () => {
    const options = { scope: 'sections' as const };
    const blocks = collectMarkdownArchiveBlocks('## Tasks\n[x] Done\n', options);
    const archived = insertMarkdownArchiveBlocks('', blocks, options);
    const task = parseMarkdownTasks(archived, options).find((node) => node.kind === 'todo');
    const restoring = collectMarkdownArchiveBlocks(archived, options, [task.lineNumber], true);
    const restored = insertMarkdownArchiveBlocks(
      removeMarkdownArchiveBlocks(archived, restoring),
      restoring,
      options,
      false
    );
    expect(
      parseMarkdownTasks(restored, options)
        .filter((node) => node.kind === 'todo' && !node.inArchive)
        .map((node) => node.title)
    ).to.deep.equal(['Done']);
  });

  it('round-trips dedented fenced content without stripping its significant whitespace', () => {
    const content = '# Tasks\n- [ ] Parent\n  - [x] Task\n    ```text\n one space\n    ```\n';
    const blocks = collectMarkdownArchiveBlocks(content, {});
    const archived = insertMarkdownArchiveBlocks(
      removeMarkdownArchiveBlocks(content, blocks),
      blocks,
      {}
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
    // Restoring the child to its original parent must preserve the relative
    // dedent rather than moving code text to the task's column.
    expect(restored).to.include('```text\n one space\n');
  });
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
