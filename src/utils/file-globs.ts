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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getRootPathsRegExp = (
    rootPaths: string[],
    platform: string = process.platform
): RegExp | undefined => {
    const roots = rootPaths.filter((rootPath) => !!rootPath);

    if (!roots.length) return;

    const patterns = roots
        .slice()
        .sort((a, b) => b.length - a.length)
        .map((rootPath) => {
            const normalizedRootPath = rootPath.replace(/\\/g, '/');
            const pattern = escapeRegExp(normalizedRootPath).replace(/\//g, '(?:\\\\|/)');

            return /\/$/.test(normalizedRootPath) ? pattern : `${pattern}(?=$|[\\\\/])`;
        });

    return new RegExp(
        `^(${patterns.join('|')})(.*)$`,
        getGlobMatchOptions(platform).nocase ? 'i' : ''
    );
};

export const isPathWithinRoot = (
    filePath: string,
    rootPath: string,
    platform: string = process.platform
): boolean => {
    const { nocase } = getGlobMatchOptions(platform);
    const normalizedPath = normalizePath(filePath);
    const normalizedRootPath = normalizePath(rootPath);
    const matchPath = nocase ? normalizedPath.toLowerCase() : normalizedPath;
    const matchRootPath = nocase ? normalizedRootPath.toLowerCase() : normalizedRootPath;

    return matchPath === matchRootPath || matchPath.startsWith(`${matchRootPath}/`);
};

export const findClosestRootPath = (
    basePath: string,
    rootPaths: string[],
    platform: string = process.platform
): string | undefined => {
    return rootPaths
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((rootPath) => isPathWithinRoot(basePath, rootPath, platform));
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
