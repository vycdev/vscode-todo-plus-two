import { expect } from 'chai';
import * as path from 'path';
import { getCoreRipgrepPath } from '../src/utils/embedded/ripgrep';

describe('VS Code ripgrep resolution', () => {
    const appRoot = path.join('opt', 'vscode');

    it('loads the supported vscode-ripgrep alias from node_modules.asar', () => {
        const expected = path.join(appRoot, 'node_modules.asar', 'vscode-ripgrep'),
            loaded: string[] = [],
            rgPath = getCoreRipgrepPath(appRoot, (modulePath) => {
                loaded.push(modulePath);

                if (modulePath === expected) return { rgPath: '/bin/rg' };

                throw new Error('module not found');
            });

        expect(rgPath).to.equal('/bin/rg');
        expect(loaded).to.deep.equal([expected]);
    });

    it('falls back to the renamed scoped package outside node_modules.asar', () => {
        const expected = path.join(appRoot, 'node_modules', '@vscode/ripgrep'),
            loaded: string[] = [],
            rgPath = getCoreRipgrepPath(appRoot, (modulePath) => {
                loaded.push(modulePath);

                if (modulePath === expected) return { default: { rgPath: '/bin/scoped-rg' } };

                throw new Error('module not found');
            });

        expect(rgPath).to.equal('/bin/scoped-rg');
        expect(loaded).to.deep.equal([
            path.join(appRoot, 'node_modules.asar', 'vscode-ripgrep'),
            path.join(appRoot, 'node_modules', 'vscode-ripgrep'),
            path.join(appRoot, 'node_modules.asar', '@vscode/ripgrep'),
            expected,
        ]);
    });

    it('returns undefined when neither package can be loaded', () => {
        expect(
            getCoreRipgrepPath(appRoot, () => {
                throw new Error('module not found');
            })
        ).to.equal(undefined);
    });
});
