const DEFAULT_BATCH_SIZE = 50;

export const getBatchSize = (value: any, fallback = DEFAULT_BATCH_SIZE): number => {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 1) return fallback;

    return Math.floor(parsed);
};
