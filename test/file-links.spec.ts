import { expect } from 'chai';
import * as path from 'path';
import { findRelativeFileLinks } from '../src/utils/file-links';

describe('Relative file links', () => {
    const documentPath = path.join(path.sep, 'workspace', 'todos', 'project.todo');

    it('resolves links from the todo document directory', () => {
        const [link] = findRelativeFileLinks('See file://./config/app.rb', documentPath);

        expect(link.targetPath).to.equal(
            path.join(path.sep, 'workspace', 'todos', 'config', 'app.rb')
        );
        expect(link.start).to.equal(4);
        expect(link.end).to.equal(26);
    });

    it('resolves parent paths and decodes URL-encoded filenames', () => {
        const [link] = findRelativeFileLinks('file://../shared/my%20file.txt', documentPath);

        expect(link.targetPath).to.equal(path.join(path.sep, 'workspace', 'shared', 'my file.txt'));
    });

    it('finds multiple links and excludes trailing punctuation from their ranges', () => {
        const text = 'Open file://./one.txt, then (file://../two.txt).';
        const links = findRelativeFileLinks(text, documentPath);

        expect(links.map((link) => text.slice(link.start, link.end))).to.deep.equal([
            'file://./one.txt',
            'file://../two.txt',
        ]);
    });

    it('ignores absolute, embedded, empty, and malformed file links', () => {
        expect(findRelativeFileLinks('file:///tmp/absolute.txt', documentPath)).to.deep.equal([]);
        expect(
            findRelativeFileLinks('https://example.test/file://./nested.txt', documentPath)
        ).to.deep.equal([]);
        expect(findRelativeFileLinks('file://./', documentPath)).to.deep.equal([]);
        expect(findRelativeFileLinks('file://./bad%ZZname.txt', documentPath)).to.deep.equal([]);
    });

    it('ignores query and fragment syntax that cannot be resolved as file paths', () => {
        expect(findRelativeFileLinks('file://./app.ts?raw=1', documentPath)).to.deep.equal([]);
        expect(findRelativeFileLinks('file://./app.ts#L10', documentPath)).to.deep.equal([]);
    });
});
