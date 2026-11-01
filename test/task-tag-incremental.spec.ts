import { expect } from 'chai';
import { withDecorationEditor } from './helpers/decoration-editor';

const styledLines = (decorations, color) =>
  Array.from(
    new Set<number>(
      [...decorations.entries()]
        .filter(([type]) => !type.disposed && type.options.color === color)
        .reduce(
          (lines: number[], [, ranges]) => lines.concat(ranges.map((range) => range.start.line)),
          []
        )
    )
  ).sort((left, right) => left - right);

describe('Incremental task-tag styles', () => {
  for (const eol of ['\n', '\r\n']) {
    it(`preserves untouched styles without rereading the document (${JSON.stringify(eol)})`, () => {
      withDecorationEditor(['Root:', '  ☐ First @red', '  ☐ Second @blue'].join(eol), (state) => {
        state.config.tags.styles = { red: { color: 'red' }, blue: { color: 'blue' } };
        state.decorator.update(state.editor);
        const reads = state.calls.fullText;
        state.edit(1, 4, 4, 'Edited ');
        expect(state.calls.fullText).to.equal(reads);
        expect(styledLines(state.decorations, 'red')).to.deep.equal([1]);
        expect(styledLines(state.decorations, 'blue')).to.deep.equal([2]);
      });
    });
  }

  it('keeps styles used by other lines while changing a tag', () => {
    withDecorationEditor('Root:\n  ☐ First @red\n  ☐ Second @red', (state) => {
      state.config.tags.styles = { red: { color: 'red' }, blue: { color: 'blue' } };
      state.decorator.update(state.editor);
      state.edit(1, 0, state.editor.document.lineAt(1).text.length, '  ☐ First @blue');
      expect(styledLines(state.decorations, 'blue')).to.deep.equal([1]);
      expect(styledLines(state.decorations, 'red')).to.deep.equal([2]);
    });
  });

  it('bounds live style resources across repeated incremental tag edits', () => {
    withDecorationEditor('Root:\n  ☐ First @custom0\n  ☐ Second @blue', (state) => {
      state.config.tags.styles = { blue: { color: 'blue' } };
      for (let index = 0; index < 20; index++)
        state.config.tags.styles[`custom${index}`] = { color: `hsl(${index * 13}, 100%, 50%)` };
      state.decorator.update(state.editor);
      const reads = state.calls.fullText;
      for (let index = 1; index < 20; index++) {
        state.edit(1, 0, state.editor.document.lineAt(1).text.length, `  ☐ First @custom${index}`);
        const live = [...state.decorations.keys()].filter(
          (type) => !type.disposed && type.options.color?.startsWith('hsl(')
        );
        expect(live).to.have.length(1);
        expect(styledLines(state.decorations, 'blue')).to.deep.equal([2]);
      }
      expect(state.calls.fullText).to.equal(reads);
    });
  });

  it('retains all new styles from a batch of changed lines', () => {
    withDecorationEditor('Root:\n  ☐ First\n  ☐ Second', (state) => {
      state.config.tags.styles = { red: { color: 'red' }, blue: { color: 'blue' } };
      state.decorator.update(state.editor);
      const reads = state.calls.fullText;
      state.setText('Root:\n  ☐ First @red\n  ☐ Second @blue');
      state.changes.onChanges({
        document: state.editor.document,
        contentChanges: [
          { range: new state.Range(1, 0, 1, 9), text: '  ☐ First @red' },
          { range: new state.Range(2, 0, 2, 10), text: '  ☐ Second @blue' },
        ],
      });
      expect(state.calls.fullText).to.equal(reads);
      expect(styledLines(state.decorations, 'red')).to.deep.equal([1]);
      expect(styledLines(state.decorations, 'blue')).to.deep.equal([2]);
    });
  });

  it('releases unused styles after both split caches update and never resubmits disposed types', () => {
    withDecorationEditor('Root:\n  ☐ First @red\n  ☐ Second @blue', (state) => {
      state.config.tags.styles = { red: { color: 'red' }, blue: { color: 'blue' } };
      const secondDecorations = new Map();
      const second = {
        ...state.editor,
        setDecorations: (type, ranges) => {
          expect(type.disposed).to.equal(false);
          secondDecorations.set(type, ranges);
        },
      };
      const originalSet = state.editor.setDecorations;
      state.editor.setDecorations = (type, ranges) => {
        expect(type.disposed).to.equal(false);
        originalSet(type, ranges);
      };
      state.window.visibleTextEditors.push(second);
      state.decorator.update(state.editor);
      const red = [...state.decorations.keys()].find((type) => type.options.color === 'red');
      const reads = state.calls.fullText;
      state.edit(1, 0, state.editor.document.lineAt(1).text.length, '  ☐ First @blue');
      expect(state.calls.fullText).to.equal(reads);
      expect(red.disposed).to.equal(true);
      for (const decorations of [state.decorations, secondDecorations]) {
        expect(styledLines(decorations, 'red')).to.deep.equal([]);
        expect(styledLines(decorations, 'blue')).to.deep.equal([1, 2]);
      }
      state.edit(1, 0, 0, '  ☐ Inserted\n');
      for (const decorations of [state.decorations, secondDecorations])
        expect(styledLines(decorations, 'blue')).to.deep.equal([2, 3]);
    });
  });
});
