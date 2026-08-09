export interface FileRoot {
    root: string;
    rootPath: string;
}

export const getUniqueRootKeys = (roots: FileRoot[]): string[] => {
    const rootPaths = roots.reduce((result, { root, rootPath }) => {
        const paths = result.get(root) || new Set<string>();
        paths.add(rootPath);
        result.set(root, paths);
        return result;
    }, new Map<string, Set<string>>());

    return roots.map(({ root, rootPath }) =>
        rootPaths.get(root)!.size > 1 ? `${root} (${rootPath})` : root
    );
};
