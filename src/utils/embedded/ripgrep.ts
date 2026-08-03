import * as path from 'path';

type ModuleLoader = (modulePath: string) => any;

function getCoreNodeModule(appRoot: string, moduleName: string, loadModule: ModuleLoader) {
    const modulePaths = [
        path.join(appRoot, 'node_modules.asar', moduleName),
        path.join(appRoot, 'node_modules', moduleName),
    ];

    for (const modulePath of modulePaths) {
        try {
            return loadModule(modulePath);
        } catch (e) {}
    }
}

export function getCoreRipgrepPath(appRoot: string, loadModule: ModuleLoader) {
    const ripgrep =
        getCoreNodeModule(appRoot, 'vscode-ripgrep', loadModule) ||
        getCoreNodeModule(appRoot, '@vscode/ripgrep', loadModule);

    return ripgrep && (ripgrep.rgPath || (ripgrep.default && ripgrep.default.rgPath));
}
