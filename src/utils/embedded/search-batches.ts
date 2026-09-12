export const getSearchFileBatches = (
  filePaths: string[],
  batchSize: number,
  maxArgumentLength = 24000
): string[][] => {
  const batches: string[][] = [];
  let batch: string[] = [];
  let argumentLength = 0;

  filePaths.forEach((filePath) => {
    // Reserve room for quoting/escaping each path and the search options.
    const length = filePath.length * 2 + 3;
    if (
      batch.length &&
      (batch.length >= batchSize || argumentLength + length > maxArgumentLength)
    ) {
      batches.push(batch);
      batch = [];
      argumentLength = 0;
    }
    batch.push(filePath);
    argumentLength += length;
  });

  if (batch.length) batches.push(batch);

  return batches;
};
