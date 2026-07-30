/* IMPORT */

import * as execa from 'execa';
import Config from '../../../config';
import { buildRgArgs } from '../rg-args';
import AG from './ag';

/* RG */ // ripgrep //URL: https://github.com/BurntSushi/ripgrep

class RG extends AG {
    static bin = 'rg';

    execa(filePaths) {
        const config = Config.get();

        return execa(
            RG.bin,
            buildRgArgs(
                config.embedded.providers.rg.regex,
                config.embedded.providers.rg.args,
                filePaths
            )
        );
    }
}

/* EXPORT */

export default RG;
