/* IMPORT */

import * as vscode from 'vscode';
import Config from '../../config';
import Consts from '../../consts';
import Utils from '../../utils';
import ProjectItem from '../items/project';
import Line from './line';

/* DECORATION TYPES */

let DECORATIONS_SIGNATURE: string;
let PROJECT_BASIC: vscode.TextEditorDecorationType;
let PROJECT_STATISTICS: vscode.TextEditorDecorationType;

function getDecorationSignature() {
    return JSON.stringify({
        project: Consts.colors.project,
        projectStatistics: Consts.colors.projectStatistics,
        dark: {
            project: Consts.colors.dark.project,
            projectStatistics: Consts.colors.dark.projectStatistics,
        },
        light: {
            project: Consts.colors.light.project,
            projectStatistics: Consts.colors.light.projectStatistics,
        },
    });
}

function ensureDecorationTypes() {
    const signature = getDecorationSignature();

    if (signature === DECORATIONS_SIGNATURE) {
        return { basic: PROJECT_BASIC, statistics: PROJECT_STATISTICS };
    }

    if (PROJECT_BASIC) PROJECT_BASIC.dispose();
    if (PROJECT_STATISTICS) PROJECT_STATISTICS.dispose();

    PROJECT_BASIC = vscode.window.createTextEditorDecorationType({
        color: Consts.colors.project,
        rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
        dark: {
            color: Consts.colors.dark.project || Consts.colors.project,
        },
        light: {
            color: Consts.colors.light.project || Consts.colors.project,
        },
    });

    PROJECT_STATISTICS = vscode.window.createTextEditorDecorationType({
        color: Consts.colors.project,
        rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
        after: {
            color: Consts.colors.projectStatistics,
            margin: '.05em 0 .05em .5em',
            textDecoration: ';font-size: .9em',
        },
        dark: {
            color: Consts.colors.dark.project || Consts.colors.project,
            after: {
                color: Consts.colors.dark.projectStatistics || Consts.colors.projectStatistics,
            },
        },
        light: {
            color: Consts.colors.light.project || Consts.colors.project,
            after: {
                color: Consts.colors.light.projectStatistics || Consts.colors.projectStatistics,
            },
        },
    });

    DECORATIONS_SIGNATURE = signature;

    return { basic: PROJECT_BASIC, statistics: PROJECT_STATISTICS };
}

/* PROJECT */

class Project extends Line {
    constructor() {
        super();

        this.TYPES = [ensureDecorationTypes().basic];
    }

    getItemRanges(project: ProjectItem, negRange?: vscode.Range | vscode.Range[]) {
        return [
            this.getRangeDifference(project.text, project.range, negRange || [Consts.regexes.tag]),
        ];
    }

    getDecorations(projects: ProjectItem[]) {
        const types = ensureDecorationTypes(),
            condition = Config.getKey('statistics.project.enabled'),
            textEditor = projects.length ? projects[0].textEditor : vscode.window.activeTextEditor;

        if (condition === false) {
            if (textEditor) textEditor.setDecorations(types.statistics, []);

            return super.getDecorations(projects);
        }

        if (textEditor) textEditor.setDecorations(types.statistics, []);

        const template = Config.getKey('statistics.project.text'),
            basicRanges = [],
            statisticRanges = [];

        projects.forEach((project) => {
            const ranges = this.getItemRanges(project)[0],
                tokens = Utils.statistics.tokens.projects[project.lineNumber],
                withStatistics = Utils.statistics.condition.is(
                    condition,
                    Utils.statistics.tokens.global,
                    tokens
                );

            if (withStatistics) {
                const contentText = Utils.statistics.template.render(template, tokens);

                statisticRanges.push(
                    ...ranges.map((range) => ({
                        range,
                        renderOptions: {
                            after: {
                                contentText,
                            },
                        },
                    }))
                );
            } else {
                basicRanges.push(...ranges);
            }
        });

        return [
            {
                type: types.basic,
                ranges: basicRanges,
            },
            {
                type: types.statistics,
                ranges: statisticRanges,
            },
        ];
    }
}

/* EXPORT */

export default Project;
