interface EmbeddedTodo {
    column?: number;
    type: string;
    todo: string;
    message?: string;
    rawLine: string;
    lineNr: number;
}

type EmbeddedDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

interface EmbeddedDiagnosticData {
    line: number;
    start: number;
    end: number;
    message: string;
    severity: EmbeddedDiagnosticSeverity;
}

const severityNames: EmbeddedDiagnosticSeverity[] = ['error', 'warning', 'info', 'hint'];

const normalizeSeverityMap = (mapping: any): { [type: string]: EmbeddedDiagnosticSeverity } => {
    const normalized: { [type: string]: EmbeddedDiagnosticSeverity } = {};

    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return normalized;

    Object.keys(mapping).forEach((type) => {
        const severity = String(mapping[type]).toLowerCase() as EmbeddedDiagnosticSeverity;

        if (severityNames.indexOf(severity) < 0) return;

        normalized[type.toUpperCase()] = severity;
    });

    return normalized;
};

const getEmbeddedDiagnosticData = (
    todos: EmbeddedTodo[],
    mapping: any
): EmbeddedDiagnosticData[] => {
    const severities = normalizeSeverityMap(mapping);

    return (todos || []).reduce((diagnostics: EmbeddedDiagnosticData[], todo) => {
        const type = String(todo.type || '').toUpperCase(),
            severity = severities[type];

        if (!severity) return diagnostics;

        const rawLine = todo.rawLine || '',
            matchedText = todo.todo || type,
            matchStart =
                typeof todo.column === 'number'
                    ? todo.column
                    : Math.max(0, rawLine.indexOf(matchedText)),
            markerStart = rawLine.toUpperCase().indexOf(type, matchStart),
            start = markerStart >= 0 ? markerStart : matchStart,
            end = Math.max(
                start + type.length,
                matchStart + matchedText.replace(/\s+$/, '').length
            ),
            message = String(todo.message || '').trim();

        diagnostics.push({
            line: todo.lineNr,
            start,
            end: Math.min(rawLine.length, end),
            message: message ? `${type}: ${message}` : type,
            severity,
        });

        return diagnostics;
    }, []);
};

export {
    EmbeddedDiagnosticData,
    EmbeddedDiagnosticSeverity,
    EmbeddedTodo,
    getEmbeddedDiagnosticData,
    normalizeSeverityMap,
};
