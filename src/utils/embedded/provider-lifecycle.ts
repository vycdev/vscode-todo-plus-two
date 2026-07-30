interface ProviderHolder {
    providerGeneration: number;
    provider?: {
        dispose(): void;
    };
}

const resetEmbeddedProvider = (holder: ProviderHolder): void => {
    holder.providerGeneration += 1;

    if (!holder.provider) return;

    holder.provider.dispose();
    holder.provider = undefined;
};

export { resetEmbeddedProvider };
