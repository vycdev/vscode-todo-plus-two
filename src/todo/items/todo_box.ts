/* IMPORT */

import Consts from '../../consts';
import { matchesTodoStatus } from '../../utils/todo-status';
import Todo from './todo';

/* TODO BOX */

class TodoBox extends Todo {
    static is(str: string) {
        return matchesTodoStatus(str, Consts.regexes.todoBox);
    }
}

/* EXPORT */

export default TodoBox;
