export const formattingRegexes = {
    formatted:
        /(?<![a-zA-Z0-9`])(`[^\n`]*`)(?![a-zA-Z`])|(?<![a-zA-Z0-9*])(\*[^\n*]+\*)(?![a-zA-Z*])|(?<![a-zA-Z0-9_])(_[^\n_]+_)(?![a-zA-Z_])|(?<![a-zA-Z0-9~])(~[^\n~]+~)(?![a-zA-Z~])/gm,
    formattedCode: /(?<![a-zA-Z0-9`])(`[^\n`]*`)(?![a-zA-Z`])/gm,
    formattedBold: /(?<![a-zA-Z0-9*])(\*[^\n*]+\*)(?![a-zA-Z*])/gm,
    formattedItalic: /(?<![a-zA-Z0-9_])(_[^\n_]+_)(?![a-zA-Z_])/gm,
    formattedStrikethrough: /(?<![a-zA-Z0-9~])(~[^\n~]+~)(?![a-zA-Z~])/gm,
};
