export const buildRgArgs = (regex: string, extraArgs: string[], filePaths: string[]): string[] => [
    ...extraArgs,
    '--color',
    'never',
    '--with-filename',
    '--heading',
    '--line-number',
    regex,
    ...filePaths,
];
