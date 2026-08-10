/* ACKMATE */

const Ackmate = {
    newLineRe: /\r?\n/g,
    filePathRe: /^:?([^]+)$/,
    matchLineRe: /^(\d+)(?:;\d+ \d+)?:([^]*)$/,

    normalizePath(filePath) {
        return filePath.replace(/\\/g, '/');
    },

    parse(str) {
        const lines = str.split(Ackmate.newLineRe);

        let filePath, match;

        return lines
            .map((line) => {
                if ((match = line.match(Ackmate.matchLineRe))) {
                    if (!filePath) return;

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
