interface DecorationRanges {
    type: any;
    ranges: any[];
}

export const applyCustomColors = (
    decorations: DecorationRanges[],
    enabled: boolean
): DecorationRanges[] =>
    enabled
        ? decorations
        : decorations.map((decoration) => ({
              type: decoration.type,
              ranges: [],
          }));
