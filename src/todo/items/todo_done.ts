/* IMPORT */

import Consts from '../../consts';
import { matchesTodoStatus } from '../../utils/todo-status';
import TodoFinished from './todo';

/* TODO DONE */

class TodoDone extends TodoFinished {
    static is(str: string) {
        return matchesTodoStatus(str, Consts.regexes.todoDone);
    }
}

/* EXPORT */

export default TodoDone;
