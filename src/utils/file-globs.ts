import * as fs from 'fs';
import * as path from 'path';

export interface ConditionalExclude {
    when: string;
}

export interface ExcludeGlobs {
    [glob: string]: boolean | ConditionalExclude;
}

export const getGlobMatchOptions = (
    platform: string = process.platform
): { dot: boolean; nocase: boolean } => ({
    dot: true,
    nocase: platform === 'win32' || platform === 'darwin',
});

const normalizePath = (filePath: string): string =>
    filePath.replace(/\\/g, '/').replace(/\/+$/, '');

export const isPathWithinRoot = (filePath: string, rootPath: string): boolean => {
    const normalizedPath = normalizePath(filePath);
    const normalizedRootPath = normalizePath(rootPath);

    return (
        normalizedPath === normalizedRootPath || normalizedPath.startsWith(`${normalizedRootPath}/`)
    );
};

export const findClosestRootPath = (basePath: string, rootPaths: string[]): string | undefined => {
    return rootPaths
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((rootPath) => isPathWithinRoot(basePath, rootPath));
};

export const getEnabledExcludeGlobs = (exclude: ExcludeGlobs = {}): string[] =>
    Object.keys(exclude || {}).filter((glob) => exclude[glob] === true);

export const hasConditionalExcludeGlobs = (exclude: ExcludeGlobs = {}): boolean =>
    Object.keys(exclude || {}).some((glob) => {
        const rule = exclude[glob];

        return !!rule && typeof rule !== 'boolean' && typeof rule.when === 'string';
    });

export const expandDirectoryExcludeGlobs = (exclude: string[] = []): string[] =>
    exclude.reduce<string[]>((globs, glob) => {
        const normalizedGlob = glob.replace(/\/+$/, '');

        if (!normalizedGlob) return globs;

        globs.push(normalizedGlob, `${normalizedGlob}/**`);

        return globs;
    }, []);

export const isFileIncluded = (
    filePath: string,
    rootPath: string | undefined,
    include: string[] = [],
    exclude: string[] = [],
    workspaceExclude: ExcludeGlobs = {}
): boolean => {
    const micromatch = require('micromatch');
    const matchPath = rootPath ? path.relative(rootPath, filePath) : filePath;
    const normalizedPath = matchPath.replace(/\\/g, '/');
    const options = getGlobMatchOptions();

    if (
        !micromatch([normalizedPath], include, {
            ignore: expandDirectoryExcludeGlobs(exclude),
            ...options,
        }).length
    ) {
        return false;
    }

    const basename = path.basename(filePath, path.extname(filePath));

    return !Object.keys(workspaceExclude || {}).some((glob) => {
        const rule = workspaceExclude[glob];

        if (
            rule === false ||
            !micromatch([normalizedPath], expandDirectoryExcludeGlobs([glob]), options).length
        ) {
            return false;
        }

        if (rule === true) return true;
        if (!rule || typeof rule.when !== 'string') return false;

        const sibling = rule.when.replace(/\$\(basename\)/g, basename);

        return fs.existsSync(path.join(path.dirname(filePath), sibling));
    });
};
