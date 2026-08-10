/* IMPORT */

import Consts from '../../consts';
import { matchesTodoStatus } from '../../utils/todo-status';
import TodoFinished from './todo';

/* TODO CANCELLED */

class TodoCancelled extends TodoFinished {
    static is(str: string) {
        return matchesTodoStatus(str, Consts.regexes.todoCancelled);
    }
}

/* EXPORT */

export default TodoCancelled;
