/* IMPORT */

import * as _ from 'lodash';
import * as execa from 'execa';
import stringMatches from 'string-matches';
import Config from '../../../config';
import Consts from '../../../consts';
import Ackmate from '../../ackmate';
import Folder from '../../folder';
import Abstract from './abstract';

/* AG */ // The Silver Searcher //URL: https://github.com/ggreer/the_silver_searcher

class AG extends Abstract {
    static bin = 'ag';

    async getFilePaths(rootPaths) {
        const globby = require('globby'); // Lazy import for performance

        return _.flatten(
            await Promise.all(
                rootPaths.map((cwd) =>
                    globby(this.include, { cwd, ignore: this.exclude, dot: true, absolute: true })
                )
            )
        );
    }

    execa(filePaths) {
        const config = Config.get();

        return execa(AG.bin, [
            '--ackmate',
            '--nobreak',
            '--nocolor',
            '--heading',
            '--print-long-lines',
            '--silent',
            ...config.embedded.providers.ag.args,
            config.embedded.providers.ag.regex,
            ...filePaths,
        ]);
    }

    async getAckmate(filePaths) {
        filePaths = _.castArray(filePaths);

        if (!filePaths.length) return [];

        try {
            const { stdout } = await this.execa(filePaths);

            return Ackmate.parse(stdout);
        } catch (e) {
            console.log(e);

            return [];
        }
    }

    filterAckmate(ackmate) {
        const filePaths = _.uniq(ackmate.map((obj) => obj.filePath)),
            includedFilePaths = this.getIncluded(filePaths);

        return ackmate.filter((obj) => includedFilePaths.includes(obj.filePath));
    }

    ackmate2data(ackmate) {
        ackmate.forEach(({ filePath, line: rawLine, lineNr }) => {
            const line = _.trimStart(rawLine),
                matches = stringMatches(line, Consts.regexes.todoEmbedded);

            if (!matches.length) return;

            const parsedPath = Folder.parsePath(filePath);

            matches.forEach((match) => {
                const data = {
                    todo: match[0],
                    type: match[1].toUpperCase(),
                    message: match[2],
                    code: line.slice(0, line.indexOf(match[0])),
                    rawLine,
                    line,
                    lineNr,
                    filePath,
                    root: parsedPath.root,
                    rootPath: parsedPath.rootPath,
                    relativePath: parsedPath.relativePath,
                };

                if (!this.filesData[filePath]) this.filesData[filePath] = [];

                this.filesData[filePath].push(data);
            });
        });
    }

    async initFilesData(rootPaths) {
        // Limit the initial external search to the include globs to avoid scanning the whole workspace.
        // This mirrors the JS provider behavior and massively reduces unnecessary IO when includes are narrow (e.g. only **/*.md).
        const filePaths = await this.getFilePaths(rootPaths);
        const ackmate = this.filterAckmate(await this.getAckmate(filePaths));

        this.filesData = {};

        this.ackmate2data(ackmate);
    }

    async updateFilesData() {
        const filePaths = Object.keys(this.filesData).filter(
                (filePath) => !this.filesData[filePath]
            ),
            ackmate = await this.getAckmate(filePaths);

        this.ackmate2data(ackmate);

        this.filesData = _.transform(
            this.filesData,
            (acc, val, key) => {
                if (!val) return;
                acc[key] = val;
            },
            {}
        );
    }
}

/* EXPORT */

export default AG;
