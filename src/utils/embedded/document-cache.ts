export const updateEmbeddedDocumentCache = (
    filesData: { [filePath: string]: any[] | undefined },
    nonEmptyFiles: Set<string>,
    filePath: string,
    data: any[]
): boolean => {
    const hadData =
        Object.prototype.hasOwnProperty.call(filesData, filePath) || nonEmptyFiles.has(filePath);

    if (!data.length && !hadData) return false;

    if (data.length) {
        filesData[filePath] = data;
        nonEmptyFiles.add(filePath);
    } else {
        delete filesData[filePath];
        nonEmptyFiles.delete(filePath);
    }

    return true;
};
