type StatisticsCondition = (
    globalTokens: { [token: string]: any } | undefined,
    projectTokens: { [token: string]: any } | undefined
) => any;

const conditionFunctions = new Map<string, StatisticsCondition>();

export const evaluateStatisticsCondition = (
    condition: boolean | string,
    globalTokens?: { [token: string]: any },
    projectTokens?: { [token: string]: any }
): boolean => {
    if (typeof condition === 'boolean') return condition;
    if (!globalTokens && !projectTokens) return false;

    try {
        let conditionFunction = conditionFunctions.get(condition);

        if (!conditionFunction) {
            conditionFunction = new Function(
                'global',
                'project',
                `return ${condition}`
            ) as StatisticsCondition;
            conditionFunctions.set(condition, conditionFunction);
        }

        return !!conditionFunction(globalTokens, projectTokens);
    } catch (error) {
        return false;
    }
};
