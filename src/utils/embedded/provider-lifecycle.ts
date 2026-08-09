interface ProviderHolder {
    providerGeneration: number;
    provider?: {
        dispose(): void;
    };
}

export interface EmbeddedRefreshQueue {
    current: Promise<void>;
}

const resetEmbeddedProvider = (holder: ProviderHolder): void => {
    holder.providerGeneration += 1;

    if (!holder.provider) return;

    holder.provider.dispose();
    holder.provider = undefined;
};

export const enqueueEmbeddedRefresh = (
    queue: EmbeddedRefreshQueue,
    refresh: () => Promise<void>
): Promise<void> => {
    const next = queue.current.then(refresh, refresh);

    // Keep the queue usable when a refresh rejects; callers still receive the original error.
    queue.current = next.catch(() => undefined);

    return next;
};

export { resetEmbeddedProvider };
