import { mapFulfilled } from './promises';

export const loadAvailableDocuments = <T>(
    filePaths: string[],
    openDocument: (filePath: string) => PromiseLike<T>,
    onRejected?: (filePath: string, error: any) => void
): Promise<T[]> => mapFulfilled(filePaths, async (filePath) => openDocument(filePath), onRejected);
