/* IMPORT */

import Consts from '../../consts';
import { matchesTodoStatus } from '../../utils/todo-status';
import Todo from './todo';

/* TODO FINISHED */

class TodoFinished extends Todo {
    static is(str: string) {
        return matchesTodoStatus(str, Consts.regexes.todoFinished);
    }
}

/* EXPORT */

export default TodoFinished;
