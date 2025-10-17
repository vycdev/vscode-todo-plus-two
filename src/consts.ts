/* IMPORT */

import * as _ from 'lodash';
import Config from './config';

/* CONSTS */

const Consts = {
    get() {
        const config = Config.get();
        const archiveName = _.get(config, 'archive.name') || 'Archive';
        const tagsNames: string[] = _.get(config, 'tags.names', []);

        function getColors(root: string) {
            return {
                done: _.get(config, `${root}.done`),
                cancelled: _.get(config, `${root}.cancelled`),
                code: _.get(config, `${root}.code`),
                comment: _.get(config, `${root}.comment`),
                project: _.get(config, `${root}.project`),
                projectStatistics: _.get(config, `${root}.projectStatistics`),
                tag: _.get(config, `${root}.tag`),
                tags: {
                    background: _.get(config, `${root}.tags.background`, []),
                    foreground: _.get(config, `${root}.tags.foreground`, []),
                },
                types: _.transform(
                    _.get(config, `${root}.types`, {}),
                    (acc: any, val: any, key: string) => {
                        acc[key.toUpperCase()] = val;
                    },
                    {}
                ),
            };
        }

        // Configured symbols (fall back to Todo+ defaults)
        const cfgBox = _.get(config, 'symbols.box', '☐');
        const cfgDone = _.get(config, 'symbols.done', '✔');
        const cfgCancelled = _.get(config, 'symbols.cancelled', '✘');

        const esc = (s: any) => _.escapeRegExp(String(s || ''));

        // Markdown checkbox forms (require leading dash + space): '- [ ]' and '- [x]'
        const mdBox = '-\\s+\\[\\s?\\]';
        const mdDone = '-\\s+\\[[xX]\\]';

        // Build per-role pattern lists and dedupe
        const boxList = _.uniq([esc('☐'), esc(cfgBox)]).filter(Boolean);
        const doneList = _.uniq([esc('✔'), esc(cfgDone)]).filter(Boolean);
        const cancelledList = _.uniq([esc('✘'), esc(cfgCancelled)]).filter(Boolean);

        const boxPattern = boxList.concat([mdBox]).join('|');
        const donePattern = doneList.concat([mdDone]).join('|');
        const cancelledPattern = cancelledList.join('|');

        const anySymbolPattern =
            (_.uniq(boxList.concat(doneList).concat(cancelledList)).join('|') || '') +
            '|' +
            mdBox +
            '|' +
            mdDone;

        const embeddedRegex = _.get(config, 'embedded.regex', '');
        const embeddedFlags = _.get(config, 'embedded.regexFlags', '');

        const regexes = {
            impossible: /(?=a)b/gm,
            empty: /^\s*$/,
            todo: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:' + anySymbolPattern + ')\\s[^\\n]*)',
                'gm'
            ),
            todoSymbol: new RegExp('^[^\\S\\n]*(?!--|––|——)(' + anySymbolPattern + ')\\s'),
            todoBox: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:' +
                    boxPattern +
                    ')\\s(?![^\\n]*[^a-zA-Z0-9]@(?:done|cancelled)(?:(?:\\([^)]*\\))|(?![a-zA-Z])))[^\\n]*)',
                'gm'
            ),
            todoBoxStarted: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:' +
                    boxPattern +
                    ')\\s(?=[^\\n]*[^a-zA-Z0-9]@started(?:(?:\\([^)]*\\))|(?![a-zA-Z])))[^\\n]*)',
                'gm'
            ),
            todoDone: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:(?:(?:' +
                    donePattern +
                    ')\\s[^\\n]*)|(?:(?:' +
                    boxPattern +
                    ')\\s[^\\n]*[^a-zA-Z0-9]@done(?:(?:\\([^)]*\\))|(?![a-zA-Z]))[^\\n]*)))',
                'gm'
            ),
            todoCancelled: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:(?:(?:' +
                    cancelledPattern +
                    ')\\s[^\\n]*)|(?:(?:' +
                    boxPattern +
                    ')\\s[^\\n]*[^a-zA-Z0-9]@cancelled(?:(?:\\([^)]*\\))|(?![a-zA-Z]))[^\\n]*)))',
                'gm'
            ),
            todoFinished: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:(?:(?:' +
                    donePattern +
                    '|' +
                    cancelledPattern +
                    ')\\s[^\\n]*)|(?:(?:' +
                    boxPattern +
                    ')\\s[^\\n]*[^a-zA-Z0-9]@(?:done|cancelled)(?:(?:\\([^)]*\\))|(?![a-zA-Z]))[^\\n]*)))',
                'gm'
            ),
            todoEmbedded: embeddedRegex ? new RegExp(embeddedRegex, embeddedFlags) : /(?=a)b/g,
            project: new RegExp(
                '^(?![^\\S\\n]*(?!--|––|——)(?:' +
                    anySymbolPattern +
                    ')\\s[^\\n]*)[^\\S\\n]*(.+:)[^\\S\\n]*(?:(?=@[^\\s*~(]+(?::\\/\\/[^\\s*~(:]+)?(?:\\([^)]*\\))?)|$)',
                'gm'
            ),
            projectParts: /(\s*)(.+):(.*)/,
            archive: new RegExp(
                '^(?![^\\S\\n]*(?!--|––|——)(?:' +
                    anySymbolPattern +
                    ')\\s[^\\n]*)([^\\S\\n]*' +
                    _.escapeRegExp(archiveName) +
                    ':.*$)',
                'gm'
            ),
            comment: new RegExp(
                '^(?!\\s*$)(?![^\\S\\n]*(?!--|––|——)(?:' +
                    anySymbolPattern +
                    ')\\s[^\\n]*)(?![^\\S\\n]*.+:[^\\S\\n]*(?:(?=@[^\\s*~(]+(?::\\/\\/[^\\s*~(:]+)?(?:\\([^)]*\\))?)|$))[^\\S\\n]*([^\\n]+)',
                'gm'
            ),
            tag: /(?:^|[^a-zA-Z0-9`])(@[^\s*~(]+(?::\/\/[^\s*~(:]+)?(?:\([^)]*\))?)/gm,
            tagSpecial: new RegExp(
                '(?:^|[^a-zA-Z0-9])@(' +
                    tagsNames.map((n: any) => _.escapeRegExp(n)).join('|') +
                    ')(?:(?:\\([^)]*\\))|(?![a-zA-Z]))',
                'gm'
            ),
            tagSpecialNormal: new RegExp(
                '(?:^|[^a-zA-Z0-9])(?:' +
                    tagsNames
                        .map(
                            (n: any) =>
                                '(@' + _.escapeRegExp(n) + '(?:(?:\\([^)]*\\))|(?![a-zA-Z])))'
                        )
                        .join('|') +
                    '|(@[^\\s*~(]+(?::\/\/[^\\s*~(:]+)?(?:(?:\\([^)]*\\))|(?![a-zA-Z]))))',
                'gm'
            ),
            tagNormal: new RegExp(
                '(?:^|[^a-zA-Z0-9])@(?!' +
                    tagsNames.map((n: any) => _.escapeRegExp(n)).join('|') +
                    '|created|done|cancelled|started|lasted|wasted|est|\\d)[^\\s*~(:]+(?::\/\/[^\\s*~(:]+)?(?:\\([^)]*\\))?'
            ),
            tagCreated: /(?:^|[^a-zA-Z0-9])@created(?:(?:\(([^)]*)\))|(?![a-zA-Z]))/,
            tagStarted: /(?:^|[^a-zA-Z0-9])@started(?:(?:\(([^)]*)\))|(?![a-zA-Z]))/,
            tagFinished: /(?:^|[^a-zA-Z0-9])@(?:done|cancelled)(?:(?:\(([^)]*)\))|(?![a-zA-Z]))/,
            tagElapsed: /(?:^|[^a-zA-Z0-9])@(?:lasted|wasted)(?:(?:\(([^)]*)\))|(?![a-zA-Z]))/,
            tagEstimate: /(?:^|[^a-zA-Z0-9])@est\(([^)]*)\)|@(\d\S+)/,
            formatted:
                /(?:^|[^a-zA-Z0-9])(?:(`[^\n`]*`)|(\*[^\n*]+\*)|(_[^\n_]+_)|(~[^\n~]+~))(?![a-zA-Z])/gm,
            formattedCode: /(?:^|[^a-zA-Z0-9])(`[^\n`]*`)(?![a-zA-Z])/gm,
            formattedBold: /(?:^|[^a-zA-Z0-9])(\*[^\n*]+\*)(?![a-zA-Z])/gm,
            formattedItalic: /(?:^|[^a-zA-Z0-9])(_[^\n_]+_)(?![a-zA-Z])/gm,
            formattedStrikethrough: /(?:^|[^a-zA-Z0-9])(~[^\n~]+~)(?![a-zA-Z])/gm,
        };

        return {
            languageId: 'todo',
            indentation: _.get(config, 'indentation'),
            timer: _.get(config, 'timer.statusbar.enabled'),
            symbols: {
                project: ':',
                box: _.get(config, 'symbols.box'),
                done: _.get(config, 'symbols.done'),
                cancelled: _.get(config, 'symbols.cancelled'),
                tag: '@',
            },
            colors: _.extend(getColors('colors'), {
                dark: getColors('colors.dark'),
                light: getColors('colors.light'),
            }),
            tags: {
                names: _.get(config, 'tags.names'),
            },
            regexes: regexes,
        };
    },

    update() {
        _.extend(Consts, Consts.get());
    },
};

Consts.update();

type IConsts = typeof Consts & ReturnType<typeof Consts.get>;

/* EXPORT */

export default Consts as IConsts;
