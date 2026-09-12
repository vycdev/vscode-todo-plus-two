/* IMPORT */

import * as _ from 'lodash';
import stringMatches from 'string-matches';
import * as vscode from 'vscode';
import Utils from '../../utils';
import LineItem from '../items/line';

/* LINE */

class Line {
  TYPES = [];

  /* RANGE */

  parseRanges(
    text: string,
    rangesRaw: vscode.Range | RegExp | vscode.Range[] | RegExp[]
  ): { start: number; end: number; startLine?: number; endLine?: number }[] {
    let negRanges = _.flatten(_.castArray(rangesRaw as any)); //TSC

    return _.filter(
      _.flatten(
        negRanges.map((neg) => {
          if (!neg) return;

          if (neg instanceof vscode.Range) {
            return {
              start: neg.start.character,
              startLine: neg.start.line,
              end: neg.end.character,
              endLine: neg.end.line,
            };
          } else if (neg instanceof RegExp) {
            const matches = stringMatches(text, neg),
              ranges = Utils.regex.matches2ranges(matches);

            return ranges;
          }
        })
      )
    );
  }

  getRangeDifference(
    text: string,
    posRange: vscode.Range,
    negRangesRaw: vscode.Range | RegExp | vscode.Range[] | RegExp[] = []
  ) {
    const posOffset = posRange.start.character;

    const negRanges = this.parseRanges(text, negRangesRaw)
      .map((range) => {
        if (typeof range.startLine === 'number') {
          if (posRange.start.line < range.startLine || posRange.start.line > range.endLine) return;
          return {
            start: range.startLine === posRange.start.line ? range.start : posRange.start.character,
            end: range.endLine === posRange.start.line ? range.end : posRange.end.character,
          };
        }

        return { start: posOffset + range.start, end: posOffset + range.end };
      })
      .filter((range) => range && range.start < range.end)
      .map((range) => ({
        start: Math.max(posRange.start.character, range.start),
        end: Math.min(posRange.end.character, range.end),
      }))
      .filter((range) => range.start < range.end)
      .sort((left, right) => left.start - right.start);
    const ranges: vscode.Range[] = [];
    let cursor = posRange.start.character;

    for (const range of negRanges) {
      if (range.start > cursor) {
        ranges.push(
          new vscode.Range(posRange.start.line, cursor, posRange.start.line, range.start)
        );
      }
      cursor = Math.max(cursor, range.end);
    }

    if (cursor < posRange.end.character) {
      ranges.push(
        new vscode.Range(posRange.start.line, cursor, posRange.start.line, posRange.end.character)
      );
    }

    return ranges;
  }

  /* ITEMS */

  getItemRanges(item: LineItem, negRanges?: vscode.Range | vscode.Range[] | RegExp | RegExp[]) {
    return _.isEmpty(negRanges)
      ? [item.range]
      : [this.getRangeDifference(item.text, item.range, negRanges)];
  }

  getItemsRanges(items: LineItem[], negRanges?: vscode.Range | vscode.Range[] | RegExp | RegExp[]) {
    const ranges = items.map((item) => this.getItemRanges(item, negRanges)),
      zipped = _.zip(...(ranges as any)), //TSC
      compact = zipped.map(_.compact),
      concat = compact.map((r) => _.concat([], ...r));

    return concat;
  }

  getDecorations(items: LineItem[], negRanges?: vscode.Range | vscode.Range[] | RegExp | RegExp[]) {
    let ranges = this.getItemsRanges(items, negRanges);

    return this.TYPES.map((type, index) => ({
      type,
      ranges: ranges[index] || [],
    }));
  }
}

/* EXPORT */

export default Line;
