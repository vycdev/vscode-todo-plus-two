export const mapFulfilled = async <T, R>(
    values: T[],
    mapper: (value: T) => Promise<R>,
    onRejected?: (value: T, error: any) => void
): Promise<R[]> => {
    const results = await Promise.all(
        values.map(async (value) => {
            try {
                return { fulfilled: true, value: await mapper(value) };
            } catch (error) {
                if (onRejected) onRejected(value, error);

                return { fulfilled: false, value: undefined };
            }
        })
    );

    return results.filter((result) => result.fulfilled).map((result) => result.value as R);
};
