import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const pkg = require('../package.json');

describe('Todo configuration schema', () => {
    it('accepts supported timer statusbar modes', () => {
        const enabled = pkg.contributes.configuration.properties['todo.timer.statusbar.enabled'];

        expect(enabled.type).to.deep.equal(['boolean', 'string']);
        expect(enabled.enum).to.deep.equal([true, false, 'estimate']);
        expect(enabled.enum).to.include(enabled.default);
    });

    it('accepts numeric timer statusbar priorities', () => {
        const priority = pkg.contributes.configuration.properties['todo.timer.statusbar.priority'];

        expect(priority.type).to.equal('number');
        expect(priority.default).to.be.a('number');
    });

    it('exposes an independent Files view icons setting', () => {
        const icons = pkg.contributes.configuration.properties['todo.file.view.icons'];
        const filesView = fs.readFileSync(path.join(__dirname, '../src/views/files.ts'), 'utf8');

        expect(icons.type).to.equal('boolean');
        expect(icons.default).to.equal(true);
        expect(filesView).to.include('this.config.file.view.icons');
        expect(filesView).not.to.include('this.config.embedded.view.icons');
    });

    it('exposes independent comment visibility for the Files view', () => {
        const showComments =
            pkg.contributes.configuration.properties['todo.file.view.showComments'];
        const filesView = fs.readFileSync(path.join(__dirname, '../src/views/files.ts'), 'utf8');

        expect(showComments.type).to.equal('boolean');
        expect(showComments.default).to.equal(false);
        expect(filesView).to.include('this.config.file.view.showComments');
        expect(filesView).not.to.include("Config.getKey('embedded.showComments')");
    });

    it('accepts automatic embedded provider selection', () => {
        const provider = pkg.contributes.configuration.properties['todo.embedded.provider'];

        expect(provider.enum).to.include(provider.default);
    });

    it('validates embedded include and exclude entries as glob strings', () => {
        const properties = pkg.contributes.configuration.properties;

        expect(properties['todo.embedded.include'].items).to.deep.equal({ type: 'string' });
        expect(properties['todo.embedded.exclude'].items).to.deep.equal({ type: 'string' });
    });

    it('accepts whole-line colors for special tags', () => {
        const colors = pkg.contributes.configuration.properties['todo.colors.tags.lineBackground'];

        expect(colors.type).to.equal('array');
        expect(colors.items.type).to.equal('string');
        expect(colors.default).to.deep.equal([]);
    });

    it('accepts embedded Problems view severity mappings', () => {
        const problems = pkg.contributes.configuration.properties['todo.embedded.problems'];

        expect(problems.type).to.equal('object');
        expect(problems.default).to.deep.equal({});
        expect(problems.additionalProperties.enum).to.deep.equal([
            'error',
            'warning',
            'info',
            'hint',
        ]);
    });
});
