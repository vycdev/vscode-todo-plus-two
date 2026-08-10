/* ACKMATE */

interface AckmateMatch {
    filePath: string;
    lineNr: number;
    line: string;
}

const Ackmate = {
    newLineRe: /\r?\n/g,
    filePathRe: /^:?([^]+)$/,
    matchLineRe: /^(\d+)(?:;\d+ \d+)?:([^]*)$/,

    normalizePath(filePath) {
        return filePath.replace(/\\/g, '/');
    },

    filterIncluded(ackmate: AckmateMatch[], includedFilePaths: string[]) {
        const includedPaths = new Set(includedFilePaths.map(Ackmate.normalizePath));

        return ackmate.filter(({ filePath }) => includedPaths.has(Ackmate.normalizePath(filePath)));
    },

    parse(str) {
        const lines = str.split(Ackmate.newLineRe);

        let filePath, match;

        return lines
            .map((line) => {
                if ((match = line.match(Ackmate.matchLineRe))) {
                    return {
                        filePath,
                        lineNr: parseInt(match[1]) - 1, // 0-index
                        line: match[2],
                    };
                } else if ((match = line.match(Ackmate.filePathRe))) {
                    filePath = Ackmate.normalizePath(match[1]);
                }
            })
            .filter(Boolean);
    },
};

/* EXPORT */

export default Ackmate;
