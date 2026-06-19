/* IMPORT */

import Consts from '../../consts';
import Item from './item';

/* TAG */

class Tag extends Item {
    isNormal() {
        return !this.isSpecial();
    }

    isSpecial() {
        return Item.is(this.text, Consts.regexes.tagSpecial);
    }

    isId() {
        return Item.is(this.text, Consts.regexes.tagId);
    }

    isDependency() {
        return Item.is(this.text, Consts.regexes.tagDependency);
    }

    static is(str: string) {
        return super.is(str, Consts.regexes.tag);
    }
}

/* EXPORT */

export default Tag;
