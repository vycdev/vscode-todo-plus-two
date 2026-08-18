/* IMPORT */

import * as _ from 'lodash';
import * as vscode from 'vscode';
import Config from '../config';
import Consts from '../consts';
import { Comment, Project, Tag, TodoBox, TodoDone, TodoCancelled } from '../todo/items';
import AST from './ast';
import { getEstimateDuration } from './estimate';
import { getStatisticsLines, getStatisticsScopeEnd } from './statistics-lines';
import { renderStatisticsTemplate } from './statistics-template';
import Tokens from './statistics_tokens';
import Time from './time';

/* STATISTICS */

const Statistics = {
    /* TIME TAGS */

    timeTags: {
        add(tag: string, tokens: Tokens, disabledTokens, disabledEst = false) {
            const prefix = tag[1];

            if (!disabledTokens.lasted && prefix === 'l') {
                // Maybe @lasted(2h)

                tokens.lastedSeconds += Statistics.timeTags.parseElapsed(tag);
            } else if (!disabledTokens.wasted && prefix === 'w') {
                // maybe @wasted(30m)

                tokens.wastedSeconds += Statistics.timeTags.parseElapsed(tag);
            } else if (
                !disabledTokens.est &&
                (prefix === 'e' || (prefix >= '0' && prefix <= '9'))
            ) {
                // Maybe @est(1h20m) or @1h20m

                tokens.estTotalSeconds += Statistics.timeTags.parseEstimate(tag);

                if (!disabledEst) tokens.estSeconds += Statistics.timeTags.parseEstimate(tag);
            }
        },

        elapseds: {},

        parseElapsed(tag: string) {
            const manHoursPerDay = Config.getKey('manHoursPerDay'),
                manDaysPerWeek = Config.getKey('manDaysPerWeek'),
                cacheKey = `${tag}:${manHoursPerDay}:${manDaysPerWeek}`;

            if (Statistics.timeTags.elapseds[cacheKey])
                return Statistics.timeTags.elapseds[cacheKey];

            const match = tag.match(Consts.regexes.tagElapsed);

            if (!match) return 0;

            const time = match[1],
                seconds = Time.durationSeconds(time, undefined, manHoursPerDay, manDaysPerWeek);

            Statistics.timeTags.elapseds[cacheKey] = seconds;

            return seconds;
        },

        estimates: {}, // It assumes that all estimates are relative to `now`

        parseEstimate(tag: string, from?: Date) {
            const manHoursPerDay = Config.getKey('manHoursPerDay'),
                manDaysPerWeek = Config.getKey('manDaysPerWeek'),
                cacheKey = `${tag}:${manHoursPerDay}:${manDaysPerWeek}`;

            if (Statistics.timeTags.estimates[cacheKey])
                return Statistics.timeTags.estimates[cacheKey];

            const time = getEstimateDuration(tag);

            if (!time) return 0;

            const seconds = Time.durationSeconds(time, from, manHoursPerDay, manDaysPerWeek);

            Statistics.timeTags.estimates[cacheKey] = seconds;

            return seconds;
        },
    },

    /* CONDITION */

    condition: {
        functions: {}, // Cache of functions created from conditions

        toFunction(condition) {
            // Avoiding repeatedly calling `eval`

            if (Statistics.condition.functions[condition])
                return Statistics.condition.functions[condition];

            const fn = new Function('global', 'project', `return ${condition}`);

            Statistics.condition.functions[condition] = fn;

            return fn;
        },

        is(condition, globalTokens, projectTokens) {
            if (_.isBoolean(condition)) return condition;

            if (!globalTokens && !projectTokens) return false;

            const fn = Statistics.condition.toFunction(condition);

            try {
                return !!fn(globalTokens, projectTokens);
            } catch (e) {
                return false;
            }
        },
    },

    /* TOKENS */

    tokens: {
        disabled: {
            // Disabled tokens, no need to compute them
            global: {},
            projects: {},
        },

        updateDisabledAll() {
            const tokens = [
                'est',
                'est-total',
                'lasted',
                'wasted',
                'elapsed',
                'est-finished',
                'est-finished-percentage',
            ]; // These are the expensive tokens

            const globalSettings = [
                'statistics.statusbar.enabled',
                'statistics.statusbar.text',
                'statistics.statusbar.tooltip',
            ]; // Global settings where tokens could be in use

            Statistics.tokens.updateDisabled(
                Statistics.tokens.disabled.global,
                tokens,
                globalSettings
            );

            const projectsSettings = ['statistics.project.enabled', 'statistics.project.text']; // Local settings where tokens could be in use

            Statistics.tokens.updateDisabled(
                Statistics.tokens.disabled.projects,
                tokens,
                projectsSettings
            );
        },

        updateDisabled(obj, tokens: string[], settings: string[]) {
            // Ugly name,

            tokens.forEach((token) => {
                obj[token] = !settings.find((setting) => _.includes(Config.getKey(setting), token));
            });
        },

        global: {},

        updateGlobal(items) {
            if (items.archive && Config.getKey('statistics.statusbar.ignoreArchive')) {
                // Keeping only items before the archive

                items = _.reduce(
                    items,
                    (acc, value, key) => {
                        const newValue = _.isArray(value)
                            ? value.filter((item) => item.lineNumber < items.archive.lineNumber)
                            : value;

                        acc[key] = newValue;

                        return acc;
                    },
                    {}
                );
            }

            const tokens = _.extend(new Tokens(), {
                comments: items.comments.length,
                projects: items.projects.length,
                tags: items.tags.length,
                pending: items.todosBox.length,
                done: items.todosDone.length,
                cancelled: items.todosCancelled.length,
            });

            // We need to add time-based tags (est/lasted/etc.) only for tags that belong
            // to pending todos — the same behavior used by project-level computation.
            // To determine whether a tag belongs to a pending todo we merge all relevant
            // item lists in line-number order and walk them sequentially, tracking
            // whether the current context is a pending todo (wasPending).

            const lines = getStatisticsLines(items);

            let wasPending = false;

            for (let i = 0, l = lines.length; i < l; i++) {
                const nextItem: any = lines[i];

                if (nextItem instanceof Tag) {
                    // tag count already accounted for in tokens.tags
                    Statistics.timeTags.add(
                        nextItem.text,
                        tokens,
                        Statistics.tokens.disabled.global,
                        !wasPending
                    );
                } else {
                    // Only tags attached to a pending todo contribute remaining estimates.
                    // Comments, projects and finished todos all end the pending context.
                    wasPending = nextItem instanceof TodoBox;
                }
            }

            Statistics.tokens.global = tokens;
        },

        projects: {},

        updateProjects(textDocument: vscode.TextDocument, items) {
            Statistics.tokens.projects = {};

            if (!items.projects) return;

            const lines = getStatisticsLines(items),
                archiveLineNumber = items.archive && items.archive.lineNumber;

            items.projects.forEach((project) => {
                Statistics.tokens.updateProject(
                    textDocument,
                    project,
                    lines,
                    lines.indexOf(project),
                    archiveLineNumber
                );
            });
        },

        updateProject(
            textDocument: vscode.TextDocument,
            project,
            lines,
            lineNr: number,
            archiveLineNumber?: number
        ) {
            if (Statistics.tokens.projects[project.lineNumber])
                return Statistics.tokens.projects[project.lineNumber];

            project.level = project.level || AST.getLevel(textDocument, project.line.text);

            const tokens = new Tokens(),
                includeRemainingDocument = project.lineNumber === archiveLineNumber,
                scopeEnd = getStatisticsScopeEnd(
                    lines,
                    lineNr,
                    project.level,
                    (item: any) => {
                        item.level = item.level || AST.getLevel(textDocument, item.line.text);

                        return item.level;
                    },
                    (item) => item instanceof Tag,
                    includeRemainingDocument
                );

            let wasPending = false;

            for (let i = lineNr + 1; i < scopeEnd; i++) {
                const nextItem = lines[i];

                if (nextItem instanceof Tag) {
                    tokens.tags++;

                    Statistics.timeTags.add(
                        nextItem.text,
                        tokens,
                        Statistics.tokens.disabled.projects,
                        !wasPending
                    );
                } else {
                    nextItem.level =
                        nextItem.level || AST.getLevel(textDocument, nextItem.line.text);

                    wasPending = nextItem instanceof TodoBox;

                    if (nextItem instanceof Project) {
                        const nextTokens = Statistics.tokens.updateProject(
                            textDocument,
                            nextItem,
                            lines,
                            i,
                            archiveLineNumber
                        );

                        tokens.comments += nextTokens.comments;
                        tokens.projects += 1 + nextTokens.projects;
                        tokens.tags += nextTokens.tags;
                        tokens.pending += nextTokens.pending;
                        tokens.done += nextTokens.done;
                        tokens.cancelled += nextTokens.cancelled;
                        tokens.estSeconds += nextTokens.estSeconds;
                        tokens.estTotalSeconds += nextTokens.estTotalSeconds;
                        tokens.lastedSeconds += nextTokens.lastedSeconds;
                        tokens.wastedSeconds += nextTokens.wastedSeconds;

                        i +=
                            nextTokens.comments +
                            nextTokens.projects +
                            nextTokens.tags +
                            nextTokens.pending +
                            nextTokens.done +
                            nextTokens.cancelled; // Jumping
                    }
                    if (nextItem instanceof Comment) {
                        tokens.comments++;
                    } else if (nextItem instanceof TodoBox) {
                        tokens.pending++;
                    } else if (nextItem instanceof TodoDone) {
                        tokens.done++;
                    } else if (nextItem instanceof TodoCancelled) {
                        tokens.cancelled++;
                    }
                }
            }

            Statistics.tokens.projects[project.lineNumber] = tokens;

            return tokens;
        },
    },

    /* TEMPLATE */

    template: {
        render(template: string, tokens = Statistics.getTokens()) {
            if (!tokens) return;

            return renderStatisticsTemplate(template, tokens, Tokens.supported);
        },
    },
};

/* EXPORT */

export default Statistics;
