import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

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
