const timeTokens = new Set(['est', 'est-total', 'est-finished', 'lasted', 'wasted', 'elapsed']);

const tagMetrics = new Set([
  'tags',
  'pending',
  'done',
  'cancelled',
  'finished',
  'all',
  'percentage',
  'est',
  'est-total',
  'lasted',
  'wasted',
  'elapsed',
  'est-finished',
  'est-finished-percentage',
]);

const tagTokenRegex = /\[tag:([^\]:\s]+)(?::([a-z-]+))?\]/g;

const tokenRegexes: { [token: string]: RegExp } = {};

const getTokenRegex = (token: string): RegExp => {
  if (!tokenRegexes[token]) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    tokenRegexes[token] = new RegExp(`\\[${escapedToken}\\]`, 'g');
  }

  return tokenRegexes[token];
};

export const renderStatisticsTemplate = (
  template: string,
  tokens: { [token: string]: any },
  supportedTokens: string[]
): string => {
  for (const token of supportedTokens) {
    const regex = getTokenRegex(token);

    if (!regex.test(template)) continue;

    let value = tokens[token];

    if (timeTokens.has(token) && value === '') value = '0s';

    template = template.replace(regex, value);
  }

  if (typeof tokens.getTagMetric === 'function') {
    template = template.replace(tagTokenRegex, (placeholder, selector, requestedMetric) => {
      const metric = requestedMetric || 'all';

      if (!tagMetrics.has(metric)) return placeholder;

      let value = tokens.getTagMetric(selector, metric);

      if (timeTokens.has(metric) && value === '') value = '0s';

      return value;
    });
  }

  return template;
};
