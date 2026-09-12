/* IMPORT */

import * as vscode from 'vscode';
import Line from './line';
import { cachedDecorationType } from './cached-type';
import CommentItem from '../items/comment';
import Consts from '../../consts';

/* DECORATION TYPES */

const COMMENT = cachedDecorationType(() => ({
  color: Consts.colors.comment,
  rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
  dark: {
    color: Consts.colors.dark.comment,
  },
  light: {
    color: Consts.colors.light.comment,
  },
}));

/* COMMENT */

class Comment extends Line {
  constructor() {
    super();
    this.TYPES = [COMMENT()];
  }

  getItemRanges(comment: CommentItem, negRange?: vscode.Range | vscode.Range[]) {
    return [
      this.getRangeDifference(
        comment.text,
        comment.range,
        negRange || [Consts.regexes.tag, Consts.regexes.formattedCode]
      ),
    ];
  }
}

/* EXPORT */

export default Comment;
