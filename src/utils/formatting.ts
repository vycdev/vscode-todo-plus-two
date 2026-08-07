export const formattingRegexes = {
    formatted:
        /(?:^|[^a-zA-Z0-9`*_~])(?:(`[^\n`]*`)|(\*[^\n*]+\*)|(_[^\n_]+_)|(~[^\n~]+~))(?![a-zA-Z`*_~])/gm,
    formattedCode: /(?:^|[^a-zA-Z0-9`*_~])(`[^\n`]*`)(?![a-zA-Z`*_~])/gm,
    formattedBold: /(?:^|[^a-zA-Z0-9`*_~])(\*[^\n*]+\*)(?![a-zA-Z`*_~])/gm,
    formattedItalic: /(?:^|[^a-zA-Z0-9`*_~])(_[^\n_]+_)(?![a-zA-Z`*_~])/gm,
    formattedStrikethrough: /(?:^|[^a-zA-Z0-9`*_~])(~[^\n~]+~)(?![a-zA-Z`*_~])/gm,
};
