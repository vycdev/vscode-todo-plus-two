import { expect } from 'chai';
import * as path from 'path';
import {
  findRelativeFileLinks,
  makeRelativeFileLink,
  rebaseRelativeFileLinks,
} from '../src/utils/file-links';

describe('Relative file links', () => {
  const workspacePath = path.resolve(path.sep, 'workspace'),
    documentPath = path.join(workspacePath, 'todos', 'project.todo');

  it('resolves links from the todo document directory', () => {
    const [link] = findRelativeFileLinks('See file://./config/app.rb', documentPath);

    expect(link.targetPath).to.equal(path.join(workspacePath, 'todos', 'config', 'app.rb'));
    expect(link.start).to.equal(4);
    expect(link.end).to.equal(26);
  });

  it('resolves parent paths and decodes URL-encoded filenames', () => {
    const [link] = findRelativeFileLinks('file://../shared/my%20file.txt', documentPath);

    expect(link.targetPath).to.equal(path.join(workspacePath, 'shared', 'my file.txt'));
  });

  it('resolves relative links with mixed-case URI schemes', () => {
    const text = 'Open FILE://./one.txt or File://../two.txt';
    const links = findRelativeFileLinks(text, documentPath);
    expect(links.map((link) => text.slice(link.start, link.end))).to.deep.equal([
      'FILE://./one.txt',
      'File://../two.txt',
    ]);
    expect(links.map((link) => link.targetPath)).to.deep.equal([
      path.join(workspacePath, 'todos', 'one.txt'),
      path.join(workspacePath, 'two.txt'),
    ]);
  });

  it('finds multiple links and excludes trailing punctuation from their ranges', () => {
    const text = 'Open file://./one.txt, then (file://../two.txt).';
    const links = findRelativeFileLinks(text, documentPath);

    expect(links.map((link) => text.slice(link.start, link.end))).to.deep.equal([
      'file://./one.txt',
      'file://../two.txt',
    ]);
  });

  it('preserves balanced closing characters in relative filenames', () => {
    const text = 'See file://./report(2026), (file://./draft[1]), and file://./build{v2}.';
    const links = findRelativeFileLinks(text, documentPath);

    expect(links.map((link) => text.slice(link.start, link.end))).to.deep.equal([
      'file://./report(2026)',
      'file://./draft[1]',
      'file://./build{v2}',
    ]);
    expect(links.map((link) => path.basename(link.targetPath))).to.deep.equal([
      'report(2026)',
      'draft[1]',
      'build{v2}',
    ]);
  });

  it('removes only unmatched closing delimiters around balanced filenames', () => {
    const text = '(file://./report(2026)), [file://./draft[1]]';
    const links = findRelativeFileLinks(text, documentPath);

    expect(links.map((link) => text.slice(link.start, link.end))).to.deep.equal([
      'file://./report(2026)',
      'file://./draft[1]',
    ]);
  });

  it('counts encoded opening delimiters when trimming relative links', () => {
    const text = 'See file://./report%282026) and (file://./draft%5B1])';
    const links = findRelativeFileLinks(text, documentPath);
    expect(links.map((link) => text.slice(link.start, link.end))).to.deep.equal([
      'file://./report%282026)',
      'file://./draft%5B1]',
    ]);
    expect(links.map((link) => path.basename(link.targetPath))).to.deep.equal([
      'report(2026)',
      'draft[1]',
    ]);
  });

  it('trims an unmatched closer after an encoded closing delimiter', () => {
    const text = '(file://./draft[1%5D])';
    const [link] = findRelativeFileLinks(text, documentPath);
    expect(text.slice(link.start, link.end)).to.equal('file://./draft[1%5D');
    expect(path.basename(link.targetPath)).to.equal('draft[1]');
  });

  it('ignores absolute, embedded, empty, and malformed file links', () => {
    expect(findRelativeFileLinks('file:///tmp/absolute.txt', documentPath)).to.deep.equal([]);
    expect(
      findRelativeFileLinks('https://example.test/file://./nested.txt', documentPath)
    ).to.deep.equal([]);
    expect(findRelativeFileLinks('file://./', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('(file://./)', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('(file://../)', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('file://./.', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('file://../.', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('file://./%2E', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('file://./bad%ZZname.txt', documentPath)).to.deep.equal([]);
  });

  it('ignores query and fragment syntax that cannot be resolved as file paths', () => {
    expect(findRelativeFileLinks('file://./app.ts?raw=1', documentPath)).to.deep.equal([]);
    expect(findRelativeFileLinks('file://./app.ts#L10', documentPath)).to.deep.equal([]);
  });

  it('encodes generated image links with spaces, delimiters, percent signs, and Unicode', () => {
    const target = path.join(workspacePath, 'todos', "tasks (#1) !'%.todo.assets", '图.png');
    const text = makeRelativeFileLink(documentPath, target);
    expect(text).to.include('tasks%20%28%231%29%20%21%27%25.todo.assets/');
    expect(findRelativeFileLinks(text, documentPath)[0].targetPath).to.equal(target);
  });

  it('keeps relative attachment targets when a task moves to a workspace-root archive', () => {
    const archivePath = path.join(workspacePath, 'ARCHIVE.TODO');
    const text =
      '✔ Done file://./project.todo.assets/image.png\n  Note (file://../shared/my%20image.jpg).';
    const rebased = rebaseRelativeFileLinks(text, documentPath, archivePath);
    expect(rebased).to.equal(
      '✔ Done file://./todos/project.todo.assets/image.png\n  Note (file://./shared/my%20image.jpg).'
    );
    expect(
      findRelativeFileLinks(rebased, archivePath).map((link) => link.targetPath)
    ).to.deep.equal(findRelativeFileLinks(text, documentPath).map((link) => link.targetPath));
  });

  it('preserves link spelling for archives in the same directory', () => {
    const text = '✔ Done FILE://./project.todo.assets/image.png';
    expect(
      rebaseRelativeFileLinks(
        text,
        documentPath,
        path.join(path.dirname(documentPath), 'ARCHIVE.project.todo')
      )
    ).to.equal(text);
  });

  it('keeps fenced code examples literal while rebasing surrounding attachments', () => {
    const archivePath = path.join(workspacePath, 'ARCHIVE.TODO');
    const text = [
      '✔ Done <file://./project.todo.assets/image.png>',
      '  ```text',
      '  file://./literal-example.png',
      '  ```',
      '  Note file://./note.png',
    ].join('\r\n');
    const rebased = rebaseRelativeFileLinks(text, documentPath, archivePath);
    expect(rebased).to.equal(
      [
        '✔ Done <file://./todos/project.todo.assets/image.png>',
        '  ```text',
        '  file://./literal-example.png',
        '  ```',
        '  Note file://./todos/note.png',
      ].join('\r\n')
    );
  });

  it('rebases parent-directory links and leaves unsupported link syntax unchanged', () => {
    const archivePath = path.join(workspacePath, 'archives', 'ARCHIVE.TODO');
    const text = 'file://../shared/image.png file://./bad%ZZ.png https://example.test/image.png';
    const rebased = rebaseRelativeFileLinks(text, documentPath, archivePath);
    expect(rebased).to.equal(
      'file://../shared/image.png file://./bad%ZZ.png https://example.test/image.png'
    );
  });
});
