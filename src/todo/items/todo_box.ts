/* IMPORT */

import Consts from '../../consts';
import { matchesTodoStatus } from '../../utils/todo-status';
import Todo from './todo';

/* TODO BOX */

class TodoBox extends Todo {
  static is(str: string) {
    // A configured '-' box must not also recognize checked Markdown tasks.
    if (/^[^\S\n]*-\s+\[[xX]\]\s/.test(str)) return false;

    return matchesTodoStatus(str, Consts.regexes.todoBox);
  }
}

/* EXPORT */

export default TodoBox;
