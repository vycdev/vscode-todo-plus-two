/* IMPORT */

import * as _ from 'lodash';
import Config from './config';
import { tagEstimateRegex } from './utils/estimate';
import {
    capturedReservedTagArgumentOrBoundary,
    createTagRegexes,
    reservedTagArgumentOrBoundary,
} from './utils/tag-regexes';
import { formattingRegexes } from './utils/formatting';

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
                started: _.get(config, `${root}.started`),
                code: _.get(config, `${root}.code`),
                comment: _.get(config, `${root}.comment`),
                project: _.get(config, `${root}.project`),
                projectStatistics: _.get(config, `${root}.projectStatistics`),
                tag: _.get(config, `${root}.tag`),
                id: _.get(config, `${root}.id`),
                dependency: _.get(config, `${root}.dependency`),
                due: {
                    overdue: _.get(config, `${root}.due.overdue`),
                    today: _.get(config, `${root}.due.today`),
                    soon: _.get(config, `${root}.due.soon`),
                    later: _.get(config, `${root}.due.later`),
                },
                tags: {
                    background: _.get(config, `${root}.tags.background`, []),
                    foreground: _.get(config, `${root}.tags.foreground`, []),
                    lineBackground: _.get(config, `${root}.tags.lineBackground`, []),
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
        const mdBox = '-\\s+\\[ \\]';
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
        const tagRegexes = createTagRegexes(tagsNames);

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
                    ')\\s(?![^\\n]*[^a-zA-Z0-9]@(?:done|cancelled)' +
                    reservedTagArgumentOrBoundary +
                    ')[^\\n]*)',
                'gm'
            ),
            todoBoxStarted: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:' +
                    boxPattern +
                    ')\\s(?=[^\\n]*[^a-zA-Z0-9]@started' +
                    reservedTagArgumentOrBoundary +
                    ')[^\\n]*)',
                'gm'
            ),
            todoDone: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:(?:(?:' +
                    donePattern +
                    ')\\s[^\\n]*)|(?:(?:' +
                    boxPattern +
                    ')\\s[^\\n]*[^a-zA-Z0-9]@done' +
                    reservedTagArgumentOrBoundary +
                    '[^\\n]*)))',
                'gm'
            ),
            todoCancelled: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:(?:(?:' +
                    cancelledPattern +
                    ')\\s[^\\n]*)|(?:(?:' +
                    boxPattern +
                    ')\\s[^\\n]*[^a-zA-Z0-9]@cancelled' +
                    reservedTagArgumentOrBoundary +
                    '[^\\n]*)))',
                'gm'
            ),
            todoFinished: new RegExp(
                '^[^\\S\\n]*((?!--|––|——)(?:(?:(?:' +
                    donePattern +
                    '|' +
                    cancelledPattern +
                    ')\\s[^\\n]*)|(?:(?:' +
                    boxPattern +
                    ')\\s[^\\n]*[^a-zA-Z0-9]@(?:done|cancelled)' +
                    reservedTagArgumentOrBoundary +
                    '[^\\n]*)))',
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
            tagSpecial: tagRegexes.tagSpecial,
            tagSpecialNormal: tagRegexes.tagSpecialNormal,
            tagNormal: tagRegexes.tagNormal,
            tagCreated: new RegExp(
                `(?:^|[^a-zA-Z0-9])@created${capturedReservedTagArgumentOrBoundary}`
            ),
            tagDue: /(?:^|[^a-zA-Z0-9])(@due\([^)]*\))/gim,
            tagStarted: new RegExp(
                `(?:^|[^a-zA-Z0-9])@started${capturedReservedTagArgumentOrBoundary}`
            ),
            tagFinished: new RegExp(
                `(?:^|[^a-zA-Z0-9])@(?:done|cancelled)${capturedReservedTagArgumentOrBoundary}`
            ),
            tagElapsed: new RegExp(
                `(?:^|[^a-zA-Z0-9])@(?:lasted|wasted)${capturedReservedTagArgumentOrBoundary}`
            ),
            tagEstimate: tagEstimateRegex,
            tagId: /@id\([^\r\n)]*\)/,
            tagDependency: /@depends\([^\r\n)]*\)/,
            ...formattingRegexes,
        };

        return {
            languageId: 'todo',
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
