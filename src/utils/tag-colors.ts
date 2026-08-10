export const getTagPaletteColor = (colors: string[] = [], index: number): string | undefined => {
    return colors.length ? colors[index % colors.length] : undefined;
};
