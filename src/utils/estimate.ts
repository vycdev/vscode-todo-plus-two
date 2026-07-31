const compactEstimateUnit =
    '(?:milliseconds?|seconds?|minutes?|hours?|days?|weeks?|years?|ms|[smhdwy])';

export const tagEstimateRegex = new RegExp(
    '(?:^|[^a-zA-Z0-9])(?:@est\\(([^)]*)\\)|@((?:\\d+(?:\\.\\d+)?' +
        compactEstimateUnit +
        ')+)(?=$|\\s))',
    'i'
);

export const getEstimateDuration = (tag: string): string | undefined => {
    const match = tag.match(tagEstimateRegex);

    return match ? match[2] || match[1] : undefined;
};
