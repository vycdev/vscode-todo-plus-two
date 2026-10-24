/* IMPORT */

import * as vscode from 'vscode';
import Consts from '../../consts';
import TodoCancelledItem from '../items/todo_cancelled';
import Line from './line';
import { cachedDecorationType } from './cached-type';

/* DECORATION TYPES */

const TODO_CANCELLED = cachedDecorationType(() => ({
  color: Consts.colors.cancelled,
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  dark: {
    color: Consts.colors.dark.cancelled,
  },
  light: {
    color: Consts.colors.light.cancelled,
  },
}));

/* TODO CANCELLED */

class TodoCancelled extends Line {
  constructor() {
    super();
    this.TYPES = [TODO_CANCELLED()];
  }

  getItemRanges(todoCancelled: TodoCancelledItem, negRange?: vscode.Range | vscode.Range[]) {
    return [
      this.getRangeDifference(
        todoCancelled.text,
        todoCancelled.range,
        negRange || [Consts.regexes.tag, Consts.regexes.formattedCode]
      ),
    ];
  }
}

/* EXPORT */

export default TodoCancelled;
