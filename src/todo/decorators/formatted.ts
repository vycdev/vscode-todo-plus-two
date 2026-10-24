/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../../consts';
import FormattedItem from '../items/formatted';
import Line from './line';
import { cachedDecorationType } from './cached-type';

/* DECORATION TYPES */

const CODE = cachedDecorationType(() => ({
  color: Consts.colors.code,
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  dark: {
    color: Consts.colors.dark.code,
  },
  light: {
    color: Consts.colors.light.code,
  },
}));

const BOLD = vscode.window.createTextEditorDecorationType({
  fontWeight: 'bold',
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const ITALIC = vscode.window.createTextEditorDecorationType({
  fontStyle: 'oblique',
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const STRIKETHROUGH = vscode.window.createTextEditorDecorationType({
  textDecoration: 'line-through',
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

/* FORMATTED */

class Formatted extends Line {
  constructor() {
    super();
    this.TYPES = [CODE(), BOLD, ITALIC, STRIKETHROUGH];
  }

  getItemRanges(formatted: FormattedItem) {
    return this.TYPES.map((type, index) => formatted.match[index + 1] && [formatted.range]);
  }
}

/* EXPORT */

export default Formatted;
