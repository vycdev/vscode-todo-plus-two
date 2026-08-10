interface DisposableLike {
    dispose(): void;
}

interface SubscriptionContext {
    subscriptions: DisposableLike[];
}

interface RefreshableView {
    id: string;
    refresh(): void;
}

type RegisterTreeDataProvider<T> = (id: string, view: T) => DisposableLike;
type OnDidChangeConfiguration = (listener: () => void) => DisposableLike;

export const registerViews = <T extends RefreshableView>(
    context: SubscriptionContext,
    views: T[],
    registerTreeDataProvider: RegisterTreeDataProvider<T>,
    onDidChangeConfiguration: OnDidChangeConfiguration
): void => {
    const registrations = views.map((view) => registerTreeDataProvider(view.id, view));
    const configurationListener = onDidChangeConfiguration(() => {
        views.forEach((view) => view.refresh());
    });

    context.subscriptions.push(...registrations, configurationListener);
};
