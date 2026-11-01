import { performance } from 'perf_hooks';
import { withDecorationEditor } from '../helpers/decoration-editor';

// npx ts-node test/benchmarks/scalability.ts [line count]
// This measures extension-side work in a simulated editor, not renderer latency.
const size = Math.max(100, Number(process.argv[2]) || 7000);
const text = Array.from({ length: size }, (_, index) =>
  index % 100 === 0 ? `Project ${index}:` : `  ☐ Task ${index} @high @est(10m)`
).join('\n');
const results = [];
for (const scenario of ['tagged title', 'estimate', 'completion', 'line insertion']) {
  for (const mode of ['full rebuild', 'incremental']) {
    withDecorationEditor(text, ({ decorator, editor, edit, changes, calls }) => {
      decorator.update(editor);
      const handler = changes.onChanges;
      let elapsed = 0;
      changes.onChanges = (event) => {
        const start = performance.now();
        if (mode === 'full rebuild') decorator.update(editor);
        else handler(event);
        elapsed = performance.now() - start;
      };
      const run = (index) => {
        const replacement =
          scenario === 'tagged title'
            ? `  ☐ Renamed ${index} @high @est(10m)`
            : scenario === 'estimate'
              ? `  ☐ Task @high @est(${10 + index}m)`
              : scenario === 'completion'
                ? `  ${index % 2 ? '☐' : '✔'} Task @high @est(10m)`
                : `  ☐ Task ${index} @high\n  ☐ Inserted`;
        edit(1, 0, editor.document.lineAt(1).text.length, replacement);
        return elapsed;
      };
      for (let index = 0; index < 3; index++) run(index);
      const before = { ...calls },
        times = Array.from({ length: 20 }, (_, index) => run(index + 3)).sort((a, b) => a - b);
      results.push({
        scenario,
        mode,
        lines: size,
        medianMs: +times[10].toFixed(3),
        p95Ms: +times[19].toFixed(3),
        parses: calls.parses - before.parses,
        projectComputations: calls.projectComputations - before.projectComputations,
        fullTextReads: calls.fullText - before.fullText,
        decorationSubmissions: calls.decorations - before.decorations,
      });
    });
  }
}
console.log(JSON.stringify(results, null, 2));
