import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    findClosestRootPath,
    getEnabledExcludeGlobs,
    getGlobMatchOptions,
    getRootPathsRegExp,
    hasConditionalExcludeGlobs,
    isFileIncluded,
    isPathWithinRoot,
} from '../src/utils/file-globs';

const micromatch = require('micromatch');

function getPackageJson() {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
}

function getDefaultFileGlobs() {
    const properties = getPackageJson().contributes.configuration.properties;

    return {
        include: properties['todo.file.include'].default,
        exclude: properties['todo.file.exclude'].default,
    };
}

describe('Default todo file globs', () => {
    it('include valid todo files without excluding hidden-folder matches', () => {
        const { include, exclude } = getDefaultFileGlobs();
        const files = [
            '.todo',
            'tasktocomplete.todo',
            'nested/tasktocomplete.todo',
            '.config/tasktocomplete.todo',
            'node_modules/TODO',
        ];
        const matches = micromatch(files, include, { ignore: exclude, dot: true });

        [
            '.todo',
            'tasktocomplete.todo',
            'nested/tasktocomplete.todo',
            '.config/tasktocomplete.todo',
        ].forEach((file) => expect(matches).to.include(file));
        expect(matches).not.to.include('node_modules/TODO');
    });

    it('include common TODO markdown and text filenames without scanning all docs', () => {
        const { include, exclude } = getDefaultFileGlobs();
        const files = ['TODO.md', 'notes/todos.txt', 'notes.md', 'notes.txt'];
        const matches = micromatch(files, include, { ignore: exclude, dot: true });

        ['TODO.md', 'notes/todos.txt'].forEach((file) => expect(matches).to.include(file));
        ['notes.md', 'notes.txt'].forEach((file) => expect(matches).not.to.include(file));
    });
});

describe('Workspace file excludes', () => {
    it('does not create a workspace root matcher without valid roots', () => {
        expect(getRootPathsRegExp([])).to.equal(undefined);
        expect(getRootPathsRegExp([''])).to.equal(undefined);
    });

    it('matches workspace roots only at path boundaries', () => {
        const rootsRe = getRootPathsRegExp(['/workspace', '/workspace/packages/app']);

        expect(rootsRe).not.to.equal(undefined);
        expect(rootsRe!.exec('/workspace-other/TODO')).to.equal(null);
        expect(rootsRe!.exec('/workspace/packages/app/TODO')![1]).to.equal(
            '/workspace/packages/app'
        );
        expect(rootsRe!.exec('/workspace/TODO')![1]).to.equal('/workspace');
    });

    it('matches Windows workspace roots across path separators', () => {
        const backslashRootRe = getRootPathsRegExp(['C:\\workspace']);
        const slashRootRe = getRootPathsRegExp(['C:/workspace']);

        expect(backslashRootRe!.exec('C:/workspace/TODO')![1]).to.equal('C:/workspace');
        expect(backslashRootRe!.exec('C:\\workspace\\TODO')![1]).to.equal('C:\\workspace');
        expect(backslashRootRe!.exec('C:/workspace-other/TODO')).to.equal(null);
        expect(slashRootRe!.exec('C:\\workspace\\TODO')![1]).to.equal('C:\\workspace');
    });

    it('does not treat similarly prefixed siblings as children of a workspace root', () => {
        expect(isPathWithinRoot('C:/workspace/project/TODO', 'C:\\workspace')).to.equal(true);
        expect(isPathWithinRoot('C:/workspace-other/TODO', 'C:\\workspace')).to.equal(false);
    });

    it('resolves the closest workspace root across Windows path separators', () => {
        const rootPaths = ['C:\\workspace', 'C:\\workspace\\packages\\app'];

        expect(findClosestRootPath('C:/workspace/packages/app/src/TODO', rootPaths)).to.equal(
            rootPaths[1]
        );
        expect(findClosestRootPath('C:/workspace-other/TODO', [rootPaths[0]])).to.equal(undefined);
    });

    it('uses only enabled files.exclude patterns', () => {
        expect(
            getEnabledExcludeGlobs({
                '**/generated/**': true,
                '**/fixtures/**': false,
                '**/*.js': { when: '$(basename).ts' },
            })
        ).to.deep.equal(['**/generated/**']);

        expect(
            hasConditionalExcludeGlobs({
                '**/generated/**': true,
                '**/*.js': { when: '$(basename).ts' },
            })
        ).to.equal(true);
        expect(hasConditionalExcludeGlobs({ '**/generated/**': true })).to.equal(false);
    });

    it('applies workspace-relative excludes alongside todo globs', () => {
        const rootPath = path.join(path.sep, 'workspace');
        const include = ['**/TODO'];
        const exclude = ['vendor', 'generated'];

        expect(
            isFileIncluded(path.join(rootPath, 'src', 'TODO'), rootPath, include, exclude)
        ).to.equal(true);
        expect(
            isFileIncluded(path.join(rootPath, 'vendor', 'TODO'), rootPath, include, exclude)
        ).to.equal(false);
        expect(
            isFileIncluded(path.join(rootPath, 'generated', 'TODO'), rootPath, include, exclude)
        ).to.equal(false);
    });

    it('applies conditional excludes when the configured sibling exists', () => {
        const rootPath = fs.mkdtempSync(path.join(process.cwd(), '.file-globs-'));
        const javascriptPath = path.join(rootPath, 'example.js');
        const typescriptPath = path.join(rootPath, 'example.ts');
        const exclude = { '**/*.js': { when: '$(basename).ts' } };

        try {
            fs.writeFileSync(javascriptPath, '');
            expect(isFileIncluded(javascriptPath, rootPath, ['**/*.js'], [], exclude)).to.equal(
                true
            );

            fs.writeFileSync(typescriptPath, '');
            expect(isFileIncluded(javascriptPath, rootPath, ['**/*.js'], [], exclude)).to.equal(
                false
            );

            fs.unlinkSync(typescriptPath);
            expect(isFileIncluded(javascriptPath, rootPath, ['**/*.js'], [], exclude)).to.equal(
                true
            );
        } finally {
            fs.unlinkSync(javascriptPath);
            if (fs.existsSync(typescriptPath)) fs.unlinkSync(typescriptPath);
            fs.rmdirSync(rootPath);
        }
    });

    it('uses filesystem case sensitivity for glob matching', () => {
        expect(getGlobMatchOptions('win32')).to.deep.equal({ dot: true, nocase: true });
        expect(getGlobMatchOptions('darwin')).to.deep.equal({ dot: true, nocase: true });
        expect(getGlobMatchOptions('linux')).to.deep.equal({ dot: true, nocase: false });

        expect(
            micromatch(['README.TXT'], ['**/*.txt'], getGlobMatchOptions('win32'))
        ).to.deep.equal(['README.TXT']);
        expect(
            micromatch(['README.TXT'], ['**/*.txt'], getGlobMatchOptions('linux'))
        ).to.deep.equal([]);
    });
});
